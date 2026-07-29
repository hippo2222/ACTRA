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

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

    // Constants
    const VALID_TASK_TYPES = new Set([
        "click",
        "draw",
        "test",
        "sequence_assembly",
        "open_answer",
        "image_labeling"
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

    function resolveTaskImageUrl(rawValue) {
        if (!rawValue && rawValue !== 0) return "";

        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                const resolved = resolveTaskImageUrl(item);
                if (resolved) return resolved;
            }
            return "";
        }

        if (rawValue && typeof rawValue === "object") {
            const nested = rawValue.image && typeof rawValue.image === "object" ? rawValue.image : null;
            const directUrl =
                rawValue.asset_url ||
                rawValue.image_asset_url ||
                rawValue.image_url ||
                rawValue.url ||
                rawValue.src ||
                (nested &&
                    (nested.asset_url ||
                        nested.image_asset_url ||
                        nested.image_url ||
                        nested.url ||
                        nested.src)) ||
                "";
            if (directUrl) return resolveTaskImageUrl(directUrl);

            const assetId =
                rawValue.asset_id ||
                rawValue.image_asset_id ||
                (nested && (nested.asset_id || nested.image_asset_id)) ||
                "";
            if (assetId) {
                return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
            }
            const legacyPath =
                rawValue.image_path ||
                rawValue.path ||
                (nested && (nested.image_path || nested.path)) ||
                "";
            if (legacyPath) return resolveTaskImageUrl(legacyPath);
            return "";
        }

        const raw = String(rawValue).trim();
        if (!raw) return "";
        if (/^(https?:|data:)/i.test(raw) || raw.startsWith("/")) return raw;
        return `/api/local-image?path=${encodeURIComponent(raw)}`;
    }

    function getTaskImageUrl(task) {
        if (!task || !task.task_data) return "";
        const td = task.task_data || {};
        const content = td.content || {};
        const directUrl =
            td.image_asset_url ||
            content.image_asset_url ||
            td.image_url ||
            content.image_url ||
            "";
        if (directUrl) return resolveTaskImageUrl(directUrl);

        const directAssetId =
            td.image_asset_id ||
            content.image_asset_id ||
            td.asset_id ||
            content.asset_id ||
            "";
        if (directAssetId) return resolveTaskImageUrl({ asset_id: directAssetId });

        return resolveTaskImageUrl(
            td.image_path ||
            content.image_path ||
            td.image ||
            content.image ||
            content.images ||
            ""
        );
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

    function buildTaskDraftStorageKey(task) {
        if (!task || typeof task !== "object") return null;

        const taskRef =
            task.task_ref
                ? String(task.task_ref)
                : (task.module_id && task.topic_id && task.task_id)
                    ? `${task.module_id}/${task.topic_id}/${task.task_id}`
                    : null;
        const queueIndex =
            task.queue && Number.isInteger(task.queue.index)
                ? task.queue.index
                : null;
        const iteration =
            Number.isInteger(task.iteration)
                ? task.iteration
                : null;
        const iterationSuffix = iteration != null ? `#iter${iteration}` : "";

        if (taskRef && queueIndex != null) {
            return `${taskRef}@${queueIndex}${iterationSuffix}`;
        }
        if (task.task_id != null) {
            return `${String(task.task_id)}${iterationSuffix}`;
        }
        return taskRef ? `${taskRef}${iterationSuffix}` : null;
    }

    // Restore Draft Helper

    function restoreDraftToUI(taskType, draft) {
        try {
            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.restoreInput === "function") {
                TestUI.restoreInput(draft);
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.restoreInput === "function") {
                SequenceUI.restoreInput(draft);
            } else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.restoreInput === "function") {
                ImageLabelUI.restoreInput(draft);
            } else if (taskType === "click" && typeof ClickUI !== "undefined" && typeof ClickUI.restoreInput === "function") {
                ClickUI.restoreInput(draft);
            } else if (taskType === "draw" && typeof DrawUI !== "undefined" && typeof DrawUI.restoreInput === "function") {
                DrawUI.restoreInput(draft);
            } else if (taskType === "open_answer" && typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.restoreInput === "function") {
                OpenAnswerUI.restoreInput(draft);
            }
        } catch (e) {
            console.error("Failed to restore draft:", e);
        }
    }

    function restoreViewStateToUI(taskType, viewState) {
        try {
            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.restoreViewState === "function") {
                TestUI.restoreViewState(viewState);
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.restoreViewState === "function") {
                SequenceUI.restoreViewState(viewState);
            } else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.restoreViewState === "function") {
                ImageLabelUI.restoreViewState(viewState);
            } else if (taskType === "click" && typeof ClickUI !== "undefined" && typeof ClickUI.restoreViewState === "function") {
                ClickUI.restoreViewState(viewState);
            } else if (taskType === "draw" && typeof DrawUI !== "undefined" && typeof DrawUI.restoreViewState === "function") {
                DrawUI.restoreViewState(viewState);
            }
        } catch (e) {
            console.error("Failed to restore view state:", e);
        }
    }

    function clearElementChildren(el) {
        if (!el) return;
        if (typeof el.replaceChildren === "function") {
            el.replaceChildren();
        } else {
            el.textContent = "";
        }
    }

    function getTaskTypeLabel(task, effectiveTaskType) {
        const rawType = getRawTaskType(task);
        const visibleTaskType = rawType || effectiveTaskType;
        const subtype = getTaskSubtype(task);
        if (visibleTaskType === "click" && subtype === "error_detection") {
            return wt('s1.task_type_error_detection', 'Поиск ошибок');
        }
        switch (visibleTaskType) {
            case "test":
                return wt('s1.task_type_test', 'Тест');
            case "sequence_assembly":
                return wt('s1.task_type_sequence', 'Последовательность');
            case "image_labeling":
                return wt('s1.task_type_image_labeling', 'Подписи на рисунке');
            case "click":
                return wt('s1.task_type_click', 'Клик');
            case "draw":
                return wt('s1.task_type_draw', 'Рисование');
            case "open_answer":
                return wt('s1.task_type_open_answer', 'Открытый ответ');
            default:
                return wt('s1.task_type_default', 'Задание');
        }
    }

    function getHeaderTitleControls() {
        return {
            titleEl: document.getElementById("current-task-title"),
            toggleEl: document.getElementById("current-task-title-toggle"),
        };
    }

    function syncHeaderTitleTooltip() {
        const { titleEl, toggleEl } = getHeaderTitleControls();
        if (titleEl) {
            titleEl.classList.remove("is-expanded");
        }
        if (toggleEl) {
            toggleEl.classList.add("hidden");
            toggleEl.hidden = true;
            toggleEl.style.display = "none";
            toggleEl.textContent = "";
            toggleEl.setAttribute("aria-expanded", "false");
            toggleEl.setAttribute("aria-hidden", "true");
        }
    }

    function bindHeaderTitleToggle() {
        syncHeaderTitleTooltip();
    }

    function normalizeHeaderTitle(title) {
        return String(title || "").replace(/\s+/g, " ").trim();
    }

    function animateCurrentTaskHeaderTitle(titleEl) {
        if (!titleEl || typeof titleEl.classList === "undefined") return;
        titleEl.classList.remove("s1-title-updated");
        try {
            void titleEl.offsetWidth;
        } catch (e) {
            // ignore
        }
        titleEl.classList.add("s1-title-updated");
        if (typeof titleEl.addEventListener === "function") {
            titleEl.addEventListener(
                "animationend",
                () => titleEl.classList.remove("s1-title-updated"),
                { once: true }
            );
        }
    }

    function setCurrentTaskHeaderTitle(title, options) {
        const nextTitle = String(title || "").trim();
        if (!nextTitle) return false;

        const titleEl = document.getElementById("current-task-title") || document.getElementById("complex-title");
        if (!titleEl) return false;

        const currentTitle = normalizeHeaderTitle(titleEl.textContent || titleEl.getAttribute("title") || "");
        const normalizedNextTitle = normalizeHeaderTitle(nextTitle);
        if (currentTitle === normalizedNextTitle) return false;

        titleEl.textContent = nextTitle;
        titleEl.setAttribute("title", nextTitle);
        titleEl.setAttribute("aria-label", nextTitle);
        if (options && options.animate) {
            animateCurrentTaskHeaderTitle(titleEl);
        }
        scheduleHeaderTitleToggleSync();
        return true;
    }

    function handleTestCurrentQuestionChanged(event) {
        const task = SessionState && SessionState.currentTask;
        if (!task || pickEffectiveTaskType(task) !== "test") return;

        const taskTitle = String(
            (event && event.detail && (event.detail.taskTitle || event.detail.sourceTaskTitle)) || ""
        ).trim();
        if (!taskTitle) return;

        setCurrentTaskHeaderTitle(taskTitle, { animate: true });
    }

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("test:current-question-changed", handleTestCurrentQuestionChanged);
    }

    function scheduleHeaderTitleToggleSync() {
        const runSync = () => syncHeaderTitleTooltip();

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(runSync);
        } else {
            runSync();
        }
    }

    function resetExtendedResultBlocks(parts) {
        const {
            keywordsBox,
            userAnswerBox,
            referenceWrap,
            referenceText,
            referenceTitle,
            decisionContext,
            decisionActions,
            decisionAcceptBtn,
            decisionRejectBtn
        } = parts || {};

        if (keywordsBox) {
            clearElementChildren(keywordsBox);
            keywordsBox.classList.add("hidden");
        }

        if (userAnswerBox) {
            clearElementChildren(userAnswerBox);
            userAnswerBox.classList.add("hidden");
        }

        if (referenceText) referenceText.textContent = "";
        if (referenceTitle) referenceTitle.textContent = "";
        if (referenceWrap) referenceWrap.classList.add("hidden");

        if (decisionContext) {
            clearElementChildren(decisionContext);
            decisionContext.classList.add("hidden");
        }

        if (decisionAcceptBtn) decisionAcceptBtn.onclick = null;
        if (decisionRejectBtn) decisionRejectBtn.onclick = null;
        if (decisionActions) decisionActions.classList.add("hidden");
    }

    function renderDrawManualJudgementContext(parts, detailsObj) {
        const {
            decisionContext,
            decisionActions,
            decisionAcceptBtn,
            decisionRejectBtn
        } = parts || {};

        const review =
            detailsObj && detailsObj.manual_label_judgement && typeof detailsObj.manual_label_judgement === "object"
                ? detailsObj.manual_label_judgement
                : null;
        const mismatches = review && Array.isArray(review.soft_mismatches)
            ? review.soft_mismatches
            : [];

        if (!decisionContext || !mismatches.length) return false;

        const list = document.createElement("div");
        list.className = "flex flex-col gap-3";

        mismatches.forEach((item, mismatchIdx) => {
            const userAnswer = String(item && item.user_answer != null ? item.user_answer : "").trim();
            const correctAnswer = String(item && item.correct_answer != null ? item.correct_answer : "").trim();
            const omittedPhrase = String(item && item.omitted_phrase != null ? item.omitted_phrase : "").trim();

            const card = document.createElement("div");
            card.className = "rounded-lg border border-warning-light bg-surface-1 px-4 py-3 shadow-sm";

            const heading = document.createElement("p");
            heading.className = "text-xs font-bold uppercase tracking-wider text-warning-dark";
            heading.textContent = wt('s1.mismatch_name', 'Название {n}').replace('{n}', mismatchIdx + 1);
            card.appendChild(heading);

            const userLine = document.createElement("p");
            userLine.className = "mt-2 text-sm font-medium text-text-main";
            userLine.textContent = wt('s1.mismatch_your_answer', 'Ваш ответ: {answer}').replace('{answer}', userAnswer || '—');
            card.appendChild(userLine);

            const referenceLine = document.createElement("p");
            referenceLine.className = "mt-1 text-sm text-text-secondary leading-relaxed";
            referenceLine.textContent = wt('s1.mismatch_reference', 'Эталон: {ref}').replace('{ref}', correctAnswer || '—');
            card.appendChild(referenceLine);

            if (omittedPhrase) {
                const omittedLine = document.createElement("p");
                omittedLine.className = "mt-2 text-sm text-warning-darker leading-relaxed";
                omittedLine.textContent = wt('s1.mismatch_omitted', 'Пропущено: {phrase}').replace('{phrase}', omittedPhrase);
                card.appendChild(omittedLine);
            }

            list.appendChild(card);
        });

        decisionContext.appendChild(list);
        decisionContext.classList.remove("hidden");

        if (decisionAcceptBtn) {
            decisionAcceptBtn.onclick = function () {
                if (
                    typeof SessionControls !== "undefined" &&
                    SessionControls &&
                    typeof SessionControls.handleDrawLabelJudgementChoice === "function"
                ) {
                    SessionControls.handleDrawLabelJudgementChoice("accept");
                }
            };
        }

        if (decisionRejectBtn) {
            decisionRejectBtn.onclick = function () {
                if (
                    typeof SessionControls !== "undefined" &&
                    SessionControls &&
                    typeof SessionControls.handleDrawLabelJudgementChoice === "function"
                ) {
                    SessionControls.handleDrawLabelJudgementChoice("reject");
                }
            };
        }

        if (decisionActions) {
            decisionActions.classList.remove("hidden");
        }

        return true;
    }

    function renderUnsupportedTaskFallback(taskContent, taskType, taskId) {
        if (!taskContent) return;

        clearElementChildren(taskContent);

        const wrap = document.createElement("div");
        wrap.className =
            "rounded-lg border-2 border-error bg-error-light p-6 text-center dark:border-error-dark dark:bg-error-light";

        const icon = document.createElement("span");
        icon.className =
            "material-symbols-outlined text-4xl text-error dark:text-error";
        icon.textContent = "error";

        const title = document.createElement("h3");
        title.className =
            "mt-3 text-lg font-semibold text-error-darker dark:text-error-lighter";
        title.textContent = wt('s1.unsupported_task_title', 'Ошибка отображения задания');

        const text = document.createElement("p");
        text.className = "mt-2 text-sm text-error-text dark:text-error";
        text.textContent =
            wt('s1.unsupported_task_msg', 'Тип задания "{type}" не поддерживается или UI-компонент не загружен.').replace('{type}', taskType || 'unknown');

        const idLine = document.createElement("p");
        idLine.className = "mt-1 text-xs text-error dark:text-error";
        idLine.textContent = `ID: ${taskId || "unknown"}`;

        wrap.appendChild(icon);
        wrap.appendChild(title);
        wrap.appendChild(text);
        wrap.appendChild(idLine);
        taskContent.appendChild(wrap);
    }

    function buildBackgroundImageValue(url) {
        const raw = String(url || "");
        const escaped = raw.replace(/["\\\n\r\f]/g, "\\$&");
        return `url("${escaped}")`;
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeRegex(value) {
        return String(value == null ? "" : value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function renderReferenceAnswerWithKeywordHighlights(referenceAnswerText, detailsObj) {
        const rawText = String(referenceAnswerText == null ? "" : referenceAnswerText);
        const keywords = Array.isArray(detailsObj && detailsObj.keywords)
            ? detailsObj.keywords
                .map((keyword) => String(keyword || "").trim())
                .filter(Boolean)
            : [];
        if (!rawText || keywords.length === 0) {
            return escapeHtml(rawText);
        }

        const foundSet = new Set(
            (Array.isArray(detailsObj && detailsObj.found_keywords) ? detailsObj.found_keywords : [])
                .map((keyword) => String(keyword || "").trim().toLowerCase())
                .filter(Boolean)
        );
        const normalizedText = rawText.toLowerCase();
        const highlights = [];
        let cursor = 0;

        function isRangeFree(start, end) {
            return !highlights.some((item) => start < item.end && end > item.start);
        }

        function findOccurrence(keyword, startIndex) {
            const normalizedKeyword = keyword.toLowerCase();
            let index = normalizedText.indexOf(normalizedKeyword, startIndex);
            while (index !== -1) {
                const end = index + normalizedKeyword.length;
                if (isRangeFree(index, end)) {
                    return { start: index, end };
                }
                index = normalizedText.indexOf(normalizedKeyword, index + normalizedKeyword.length);
            }
            return null;
        }

        for (const keyword of keywords) {
            const normalizedKeyword = keyword.toLowerCase();
            const sequentialMatch = findOccurrence(keyword, cursor);
            const fallbackMatch = sequentialMatch || findOccurrence(keyword, 0);
            if (!fallbackMatch) continue;

            highlights.push({
                ...fallbackMatch,
                normalizedKeyword,
                isFound: foundSet.has(normalizedKeyword),
            });
            cursor = fallbackMatch.end;
        }

        if (highlights.length === 0) {
            return escapeHtml(rawText);
        }

        highlights.sort((left, right) => left.start - right.start);
        let html = "";
        let lastIndex = 0;

        for (const highlight of highlights) {
            if (highlight.start > lastIndex) {
                html += escapeHtml(rawText.slice(lastIndex, highlight.start));
            }
            const className = highlight.isFound
                ? "rounded-md border border-success/30 bg-success-light/35 px-1 py-0.5 font-semibold text-success-darker"
                : "rounded-md border border-error/30 bg-error-light/30 px-1 py-0.5 font-semibold text-error-darker";
            html += `<span class="${className}">${escapeHtml(rawText.slice(highlight.start, highlight.end))}</span>`;
            lastIndex = highlight.end;
        }

        if (lastIndex < rawText.length) {
            html += escapeHtml(rawText.slice(lastIndex));
        }

        return html;
    }

    // Result Display Helper

    function normalizeSequenceEvaluationMessage(messageText, detailsObj) {
        if (!messageText || !detailsObj || detailsObj.levels_order_correct !== true) {
            return messageText;
        }

        const totalLevelsRaw =
            Number(detailsObj.total_levels) ||
            (Array.isArray(detailsObj.correct_levels_data) ? detailsObj.correct_levels_data.length : 0);
        const totalLevels = Number.isFinite(totalLevelsRaw) && totalLevelsRaw > 0 ? totalLevelsRaw : 0;
        if (!totalLevels) {
            return messageText;
        }

        return messageText.replace(
            /(\()(\d+)\/(\d+)(\s+уровней\s+правильно)/u,
            (match, open, shownCount, totalFromText, suffix) => {
                const shown = Number(shownCount);
                const total = Number(totalFromText);
                if (!Number.isFinite(shown) || !Number.isFinite(total)) {
                    return match;
                }
                if (shown === total && total === totalLevels) {
                    return match;
                }
                return `${open}${totalLevels}/${totalLevels}${suffix}`;
            }
        );
    }

    function showEvaluationResult(result) {
        function buildToleranceExplanation(candidate) {
            if (!candidate || typeof candidate !== "object") return "";
            if (candidate.tolerance_explanation != null) {
                const direct = String(candidate.tolerance_explanation).trim();
                if (direct) return direct;
            }

            const toleranceType =
                candidate.tolerance_type != null
                    ? String(candidate.tolerance_type).trim().toLowerCase()
                    : "";
            const rawKinds = Array.isArray(candidate.normalization_kinds)
                ? candidate.normalization_kinds
                : [];
            const kindLabels = [];
            rawKinds.forEach((kind) => {
                const key = String(kind || "").trim().toLowerCase();
                const labelMap = { layout: wt('s1.norm_layout', 'раскладки'), yo: wt('s1.norm_yo', 'е/ё'), y_i: wt('s1.norm_y_i', 'ы/і') };
                const label = labelMap[key];
                if (label && !kindLabels.includes(label)) kindLabels.push(label);
            });
            const normalizedSuffix = kindLabels.length
                ? kindLabels.length === 1
                    ? kindLabels[0]
                    : kindLabels.length === 2
                        ? `${kindLabels[0]}${wt('s1.and_conjunction', ' и ')}${kindLabels[1]}`
                        : `${kindLabels.slice(0, -1).join(", ")}${wt('s1.and_conjunction', ' и ')}${kindLabels[kindLabels.length - 1]}`
                : wt('s1.norm_text', 'текста');

            if (toleranceType === "typo") return wt('s1.tolerance_typo', 'Ответ засчитан с учетом опечатки.');
            if (toleranceType === "ending") return wt('s1.tolerance_ending', 'Ответ засчитан с учетом формы слова.');
            if (toleranceType === "both") return wt('s1.tolerance_both', 'Ответ засчитан с учетом формы слова и опечатки.');
            if (toleranceType === "normalized") return wt('s1.tolerance_normalized', 'Ответ засчитан после нормализации {suffix}.').replace('{suffix}', normalizedSuffix);
            return "";
        }

        function extractToleranceExplanation(detailsObj) {
            if (!detailsObj || typeof detailsObj !== "object") return "";
            const candidates = [
                detailsObj,
                detailsObj.label,
                detailsObj.labels,
                detailsObj.level_names,
                detailsObj.block_names,
            ];
            for (const candidate of candidates) {
                const explanation = buildToleranceExplanation(candidate);
                if (explanation) return explanation;
            }
            return "";
        }

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
        const decisionContext = document.getElementById("result-decision-context");
        const decisionActions = document.getElementById("result-decision-actions");
        const decisionAcceptBtn = document.getElementById("result-decision-accept");
        const decisionRejectBtn = document.getElementById("result-decision-reject");
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
                resetExtendedResultBlocks({
                    keywordsBox,
                    userAnswerBox,
                    decisionContext,
                    decisionActions,
                    decisionAcceptBtn,
                    decisionRejectBtn,
                    referenceWrap,
                    referenceText,
                    referenceTitle
                });
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
            resetExtendedResultBlocks({
                keywordsBox,
                userAnswerBox,
                decisionContext,
                decisionActions,
                decisionAcceptBtn,
                decisionRejectBtn,
                referenceWrap,
                referenceText,
                referenceTitle
            });
            if (inner) inner.className = "flex flex-col rounded-lg border border-border-strong bg-surface-2 dark:bg-surface-2 overflow-hidden";
            return;
        }

        if (box) {
            box.classList.add("result-entering");
            box.classList.remove("hidden");
            requestAnimationFrame(() => box.classList.remove("result-entering"));
        }

        const detailsObj = result && result.details && typeof result.details === "object" ? result.details : null;
        const pendingUserJudgement = !!(detailsObj && detailsObj.requires_user_judgement === true);
        const success = result.success === true;
        if (inner) {
            inner.className =
                "flex flex-col rounded-xl border-l-4 border overflow-hidden shadow-sm " +
                (pendingUserJudgement
                    ? "border-l-warning border-border-strong bg-surface-2"
                    : success
                        ? "border-l-success border-border-strong bg-surface-2"
                        : "border-l-error border-border-strong bg-surface-2");
        }

        if (header) {
            header.className =
                "flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle " +
                (pendingUserJudgement
                    ? "bg-warning-lighter"
                    : success
                        ? "bg-success-light/30"
                        : "bg-error-light/30");
        }

        if (iconWrap) {
            iconWrap.className =
                "flex items-center justify-center size-9 rounded-full shrink-0 border border-border-strong " +
                (pendingUserJudgement
                    ? "bg-surface-1 text-warning-dark"
                    : success
                        ? "bg-surface-1 text-success-dark"
                        : "bg-surface-1 text-error-dark");
        }

        // Animated SVG icons via SuccessEffects
        if (pendingUserJudgement && iconWrap) {
            if (typeof iconWrap.replaceChildren === "function") {
                iconWrap.replaceChildren();
            } else {
                iconWrap.textContent = "";
            }
            const pendingIcon = icon || document.createElement("span");
            pendingIcon.id = pendingIcon.id || "result-icon";
            pendingIcon.className = "material-symbols-outlined text-[20px]";
            pendingIcon.textContent = "help";
            iconWrap.appendChild(pendingIcon);
        } else if (typeof SuccessEffects !== 'undefined' && iconWrap) {
            if (success) {
                SuccessEffects.renderAnimatedCheckmark(iconWrap);
            } else {
                SuccessEffects.renderAnimatedCross(iconWrap);
            }
        } else if (icon) {
            icon.textContent = pendingUserJudgement ? "help" : success ? "check" : "close";
        }

        if (title) {
            title.textContent = pendingUserJudgement
                ? wt('s1.result_pending_judgement', 'Нужно ваше решение')
                : success
                    ? wt('s1.result_accepted', 'Ответ принят')
                    : wt('s1.result_wrong', 'Ответ неверный');
            title.className =
                "text-sm font-bold leading-tight " +
                "text-text-main dark:text-text-on-dark";
        }

        // Streak badge (only on success)
        if (typeof SuccessEffects !== 'undefined' && header) {
            SuccessEffects.renderStreakBadge(
                header,
                !pendingUserJudgement && success ? SuccessEffects.getStreak() : 0
            );
        }

        let messageText = result && result.message ? String(result.message) : "";

        // Logic for Sequence Assembly Hints
        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            const difficulty = Number(
                (SessionState && SessionState.currentTask && SessionState.currentTask.difficulty) || 1
                // simplified lookup
            );
            if (
                currentTaskType === "test" &&
                detailsObj &&
                Number.isFinite(Number(detailsObj.correct_count)) &&
                Number.isFinite(Number(detailsObj.total_count))
            ) {
                const correctCount = Number(detailsObj.correct_count);
                const totalCount = Number(detailsObj.total_count);
                const incorrectCount = Math.max(0, totalCount - correctCount);
                if (totalCount > 0) {
                    if (correctCount >= totalCount) {
                        messageText = wt('s1.test_result_correct', '✅ Правильно! {correct}/{total} ответов').replace('{correct}', correctCount).replace('{total}', totalCount);
                    } else {
                        messageText = wt('s1.test_result_errors', '❌ Есть ошибки: {incorrect} из {total} с ошибкой, верно {correct}').replace('{incorrect}', incorrectCount).replace('{total}', totalCount).replace('{correct}', correctCount);
                    }
                }
            }
            if (currentTaskType === "sequence_assembly") {
                messageText = normalizeSequenceEvaluationMessage(messageText, detailsObj);
            }
            if (currentTaskType === "sequence_assembly" && difficulty === 2) {
                if (messageText && messageText.toLowerCase().includes("\u043d\u0435\u0432\u0435\u0440\u043d\u043e\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0443\u0440\u043e\u0432\u043d\u0435\u0439")) {
                    messageText = "\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0443\u0440\u043e\u0432\u043d\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442. \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0439\u0442\u0435 \u0433\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b \u043f\u043e \u0443\u0440\u043e\u0432\u043d\u044f\u043c \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.";
                }
            }
            if (currentTaskType === "image_labeling" && detailsObj) {
                const zoneResults = detailsObj.zone_results || detailsObj || {};
                const totalCount = Number(detailsObj.total_count) || Object.keys(zoneResults).length;
                const correctCount = Number(detailsObj.correct_count) !== undefined 
                    ? Number(detailsObj.correct_count) 
                    : Object.values(zoneResults).filter(z => (typeof z === 'object' ? z.is_correct === true : z === true)).length;
                const incorrectCount = Math.max(0, totalCount - correctCount);
                if (totalCount > 0) {
                    if (correctCount >= totalCount) {
                        messageText = `✅ Все подписи расставлены верно (${correctCount}/${totalCount})`;
                    } else {
                        messageText = `Есть ошибки: ${incorrectCount} из ${totalCount} с ошибкой, верно ${correctCount}`;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            const rawTaskType = SessionState && SessionState.currentTask
                ? getRawTaskType(SessionState.currentTask)
                : null;
            const isDrawTask =
                currentTaskType === "draw" ||
                (rawTaskType === "draw" && currentTaskType === "click");
            if (pendingUserJudgement && isDrawTask && detailsObj) {
                const review =
                    detailsObj.manual_label_judgement && typeof detailsObj.manual_label_judgement === "object"
                        ? detailsObj.manual_label_judgement
                        : null;
                if (!messageText) {
                    messageText = review && review.message
                        ? String(review.message)
                        : wt('s1.draw_judgement_message', 'В одном или нескольких названиях пропущено 1–2 слова. Решите, считать ли ответ верным.');
                }
            }
        } catch (e) {
            // ignore
        }
        if (msg) msg.textContent = messageText;

        let extra =
            (detailsObj && (detailsObj.explanation != null ? String(detailsObj.explanation) : "")) ||
            (detailsObj && (detailsObj.raw != null ? String(detailsObj.raw) : "")) ||
            extractToleranceExplanation(detailsObj) ||
            "";

        if (details) details.textContent = extra;

        // Render visual error comparison chips for image_labeling
        try {
            if (getCurrentEffectiveTaskType() === "image_labeling" && userAnswerBox && detailsObj && detailsObj.zone_results) {
                const incorrectEntries = Object.entries(detailsObj.zone_results).filter(([zId, zRes]) => typeof zRes === 'object' && zRes.is_correct === false);
                
                if (incorrectEntries.length > 0) {
                    userAnswerBox.classList.remove('hidden');
                    userAnswerBox.innerHTML = '';

                    const errTitle = document.createElement('h4');
                    errTitle.className = 'text-xs font-bold uppercase tracking-wider text-text-secondary mb-2.5 flex items-center gap-1.5';
                    errTitle.innerHTML = `<span class="material-symbols-outlined text-[16px] text-rose-500">error</span><span>Разбор ошибок</span>`;
                    userAnswerBox.appendChild(errTitle);

                    const grid = document.createElement('div');
                    grid.className = 'flex flex-col gap-2';

                    incorrectEntries.forEach(([zId, zRes]) => {
                        const zoneLabel = zRes.label || zRes.expected || zId;
                        const userVal = zRes.actual || 'не указано';
                        const expectedVal = zRes.expected || zoneLabel;

                        const row = document.createElement('div');
                        row.className = 'flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-1 border border-border-subtle shadow-sm text-xs';
                        row.innerHTML = `
                            <span class="font-semibold text-text-main flex items-center gap-1.5">
                                <span class="material-symbols-outlined text-[15px] text-primary">label</span>
                                ${zoneLabel}
                            </span>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-600 border border-rose-500/30 font-bold">
                                    <span class="text-[10px] opacity-80">Ваш ответ:</span> ${userVal}
                                </span>
                                <span class="material-symbols-outlined text-[14px] text-text-tertiary">arrow_forward</span>
                                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 font-bold">
                                    <span class="text-[10px] opacity-80">Должно быть:</span> ${expectedVal}
                                </span>
                            </div>
                        `;
                        grid.appendChild(row);
                    });
                    userAnswerBox.appendChild(grid);
                }
            }
        } catch (e) { /* ignore */ }

        resetExtendedResultBlocks({
            keywordsBox,
            userAnswerBox,
            decisionContext,
            decisionActions,
            decisionAcceptBtn,
            decisionRejectBtn,
            referenceWrap,
            referenceText,
            referenceTitle
        });

        // D-4 fix: Render Keywords, UserAnswer, Reference for open_answer
        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            if (currentTaskType === "open_answer" && detailsObj) {
                const userAnswerText =
                    detailsObj.user_answer != null ? String(detailsObj.user_answer) : "";
                if (userAnswerBox && userAnswerText) {
                    userAnswerBox.classList.remove("hidden");

                    const uaTitle = document.createElement("h4");
                    uaTitle.className = "text-xs font-bold uppercase tracking-wider text-text-secondary";
                    uaTitle.textContent = "\u0412\u0430\u0448 \u043e\u0442\u0432\u0435\u0442";
                    userAnswerBox.appendChild(uaTitle);

                    const uaCard = document.createElement("div");
                    uaCard.className = "rounded-lg border border-border-strong bg-surface-1 p-3 text-sm text-text-main leading-relaxed";
                    uaCard.textContent = userAnswerText;
                    userAnswerBox.appendChild(uaCard);
                }

                const referenceAnswerText =
                    detailsObj.reference_answer != null ? String(detailsObj.reference_answer) : "";
                if (referenceWrap && referenceAnswerText) {
                    referenceWrap.classList.remove("hidden");
                    if (referenceTitle) referenceTitle.textContent = "\u042d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442";
                    if (referenceText) {
                        referenceText.innerHTML = renderReferenceAnswerWithKeywordHighlights(referenceAnswerText, detailsObj);
                    }
                }
            }
        } catch (e) {
            console.warn("[TaskRenderer] Keywords/reference render error:", e);
        }

        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            const rawTaskType = SessionState && SessionState.currentTask
                ? getRawTaskType(SessionState.currentTask)
                : null;
            const isDrawTask =
                currentTaskType === "draw" ||
                (rawTaskType === "draw" && currentTaskType === "click");
            if (isDrawTask && pendingUserJudgement && detailsObj) {
                renderDrawManualJudgementContext({
                    decisionContext,
                    decisionActions,
                    decisionAcceptBtn,
                    decisionRejectBtn
                }, detailsObj);
            } else if (pendingUserJudgement && detailsObj) {
                if (decisionActions) {
                    decisionActions.classList.remove("hidden");
                }
                if (decisionAcceptBtn) {
                    decisionAcceptBtn.textContent = wt('s1.result_accept_typo', wt('s1.result_accept', 'Засчитать как верное'));
                    decisionAcceptBtn.setAttribute('data-i18n', 's1.result_accept_typo');
                    decisionAcceptBtn.onclick = function () {
                        if (typeof SessionControls !== 'undefined' && typeof SessionControls.handleUserJudgementChoice === 'function') {
                            SessionControls.handleUserJudgementChoice('accept');
                        } else if (typeof window.handleUserJudgementChoice === 'function') {
                            window.handleUserJudgementChoice('accept');
                        } else if (typeof window.handleSubmitAnswer === 'function') {
                            window.handleSubmitAnswer({ override_typo: true, single_retry_copy: false });
                        }
                    };
                }
                if (decisionRejectBtn) {
                    decisionRejectBtn.textContent = wt('s1.result_retry_typo', 'Повторить (1 копия)');
                    decisionRejectBtn.setAttribute('data-i18n', 's1.result_retry_typo');
                    decisionRejectBtn.onclick = function () {
                        if (typeof SessionControls !== 'undefined' && typeof SessionControls.handleUserJudgementChoice === 'function') {
                            SessionControls.handleUserJudgementChoice('reject');
                        } else if (typeof window.handleUserJudgementChoice === 'function') {
                            window.handleUserJudgementChoice('reject');
                        } else if (typeof window.handleSubmitAnswer === 'function') {
                            window.handleSubmitAnswer({ override_typo: false, single_retry_copy: true });
                        }
                    };
                }
            }
        } catch (e) {
            console.warn("[TaskRenderer] Draw/Judgement render error:", e);
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
                } else if (prevType === "image_labeling") {
                    if (typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.cleanup === "function") {
                        ImageLabelUI.cleanup();
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
        const currentTaskTitleEl =
            document.getElementById("current-task-title") || document.getElementById("complex-title");
        const currentTaskTypeEl =
            document.getElementById("current-task-type") || document.getElementById("session-subtitle");
        const taskProgressMetaEl =
            document.getElementById("task-progress-meta") || document.getElementById("task-header-meta");
        const taskHeaderBlock = document.getElementById("task-header-block");
        const taskHeaderLabelEl = document.getElementById("task-header-label");
        const progressLabel = document.getElementById("progress-label");
        const difficultyLabel = document.getElementById("difficulty-label");
        const progressBar = document.getElementById("progress-bar");
        const currentTaskTitleToggleEl = document.getElementById("current-task-title-toggle");

        if (!task) {
            if (SessionState) SessionState.currentTask = null;
            if (SessionState) SessionState.currentTaskChecked = false;
            if (SessionState) SessionState.currentEvaluationResult = null;
            if (SessionState) SessionState.pendingManualJudgement = false;
            UIHelpers.setCanGoNext(false);
            if (titleEl) titleEl.textContent = "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439";
            if (metaEl) metaEl.textContent = "";
            if (refEl) refEl.textContent = "";
            if (descEl) descEl.textContent = "";
            if (currentTaskTitleEl) {
                currentTaskTitleEl.textContent = "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439";
                currentTaskTitleEl.classList.remove("is-expanded");
            }
            if (currentTaskTypeEl) currentTaskTypeEl.textContent = "\u2013";
            if (taskProgressMetaEl) taskProgressMetaEl.textContent = "";
            if (currentTaskTitleToggleEl) {
                currentTaskTitleToggleEl.classList.add("hidden");
                currentTaskTitleToggleEl.setAttribute("aria-expanded", "false");
            }
            if (taskHeaderLabelEl) taskHeaderLabelEl.textContent = wt('s1.task_instruction_label', 'Что нужно сделать');
            if (imgEl) {
                imgEl.style.backgroundImage = "none";
            }
            if (progressLabel) progressLabel.textContent = "\u0417\u0430\u0434\u0430\u043d\u0438\u0435 \u2013";
            if (difficultyLabel) {
                difficultyLabel.textContent = "\u0421\u043b\u043e\u0436\u043d\u043e\u0441\u0442\u044c: -";
                difficultyLabel.classList.add("hidden");
            }
            if (progressBar) progressBar.style.width = "0%";
            const checkBtn = document.getElementById("check-answer-btn");
            if (checkBtn) {
                checkBtn.disabled = true;
                checkBtn.classList.add("hidden");
            }
            const taskHeaderMeta = document.getElementById("task-header-meta");
            if (taskHeaderMeta) taskHeaderMeta.classList.add("hidden");
            if (taskHeaderBlock) taskHeaderBlock.classList.add("hidden");
            const statusBanner = document.getElementById("status-banner");
            if (statusBanner) {
                statusBanner.classList.add("hidden");
                statusBanner.textContent = "";
            }
            showEvaluationResult(null);
            const taskContent = document.getElementById("task-content");
            if (taskContent) {
                clearElementChildren(taskContent);
                const emptyState = document.createElement("div");
                emptyState.className =
                    "rounded-lg border border-border-strong bg-surface-2 p-6 text-center text-sm text-text-secondary";
                emptyState.textContent =
                    "\u0414\u043b\u044f \u044d\u0442\u043e\u0439 \u0441\u0435\u0441\u0441\u0438\u0438 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439.";
                taskContent.appendChild(emptyState);
            }
            return;
        }

        const titleFromData =
            task.task_name ||
            task.name ||
            (task.task_data &&
                (task.task_data.meta?.name ||
                    task.task_data.meta?.title ||
                    task.task_data.name ||
                    task.task_data.title ||
                    task.task_data.content?.task_name ||
                    task.task_data.content?.title)) ||
            "";

        const questionFromData =
            (task.task_data &&
                (task.task_data.content?.question ||
                    task.task_data.question ||
                    task.task_data.content?.prompt ||
                    task.task_data.prompt ||
                    "")) || "";

        const descriptionFromData =
            (task.task_data &&
                (task.task_data.description ||
                    task.task_data.content?.description ||
                    task.task_data.content?.prompt ||
                    "")) || "";

        const imageUrlFromData = getTaskImageUrl(task);

        const currentTaskType = pickEffectiveTaskType(task);
        const rawTaskType = getRawTaskType(task);
        const taskSubtype = getTaskSubtype(task);
        const taskTypeLabel = getTaskTypeLabel(task, currentTaskType);
        const normalizedTitle = String(titleFromData || "").trim();
        const normalizedQuestion = String(questionFromData || "").trim();
        const normalizedDescription = String(descriptionFromData || "").trim();
        const isOpenAnswerTask = currentTaskType === "open_answer";
        const keepPromptInsideTaskSurface =
            currentTaskType === "sequence_assembly" || currentTaskType === "open_answer" || currentTaskType === "image_labeling";
        const preferredTitle =
            normalizedTitle ||
            (!keepPromptInsideTaskSurface ? normalizedQuestion : "") ||
            String(task.task_name || task.name || task.task_id || "").trim() ||
            wt('s1.task_type_default', 'Задание');
        const headerTitle = preferredTitle;
        const headerMeta = isOpenAnswerTask
            ? (normalizedTitle && normalizedTitle !== normalizedQuestion
                ? normalizedTitle
                : wt('s1.open_answer_label', 'Открытый ответ'))
            : wt('s1.iteration_label', 'Итерация {iter}').replace('{iter}', task.iteration ?? '?');
        const headerDescription = isOpenAnswerTask
            ? ((normalizedDescription && normalizedDescription !== normalizedQuestion)
                ? normalizedDescription
                : "")
            : descriptionFromData;
        const shouldShowInstructionBlock = (
            !!normalizedQuestion &&
            normalizedQuestion !== headerTitle &&
            rawTaskType === "click" &&
            taskSubtype !== "error_detection"
        );
        const shouldInlineClickInstruction = rawTaskType === "click";
        const instructionMeta = normalizedTitle && normalizedTitle !== normalizedQuestion
            ? normalizedTitle
            : "";
        const instructionDescription = normalizedDescription &&
            normalizedDescription !== normalizedQuestion &&
            normalizedDescription !== instructionMeta
            ? normalizedDescription
            : "";

        if (titleEl) titleEl.textContent = headerTitle;
        if (descEl) descEl.textContent = headerDescription;
        if (refEl)
            refEl.textContent = `${task.module_id}/${task.topic_id}/${task.task_id}`;
        if (metaEl) metaEl.textContent = headerMeta;
        if (currentTaskTitleEl) {
            currentTaskTitleEl.textContent = headerTitle;
            currentTaskTitleEl.setAttribute("title", headerTitle);
            currentTaskTitleEl.setAttribute("aria-label", headerTitle);
        }
        if (currentTaskTypeEl) currentTaskTypeEl.textContent = taskTypeLabel;
        bindHeaderTitleToggle();

        if (imgEl) {
            if (imageUrlFromData) {
                imgEl.style.backgroundImage = buildBackgroundImageValue(imageUrlFromData);
                imgEl.style.display = "block";
            } else {
                imgEl.style.backgroundImage = "none";
                imgEl.style.display = "none";
            }
        }

        const index = task.queue?.index ?? 0;
        const total = task.queue?.total ?? 0;
        if (progressLabel) {
            const progressParts = [];
            progressParts.push(
                total && index != null
                    ? wt('s1.task_n_of_total', 'Задание {n} из {total}').replace('{n}', index + 1).replace('{total}', total)
                    : wt('s1.task_type_default', 'Задание') + ' \u2013'
            );
            progressParts.push(wt('s1.iteration_label', 'Итерация {iter}').replace('{iter}', task.iteration ?? '?'));
            progressLabel.textContent = progressParts.join(" \u2022 ");
        }

        const difficulty = task.difficulty ?? null;
        if (difficultyLabel) {
            difficultyLabel.textContent =
                difficulty != null ? wt('s1.difficulty_label', 'Сложность: {n}').replace('{n}', difficulty) : wt('s1.difficulty_unknown', 'Сложность: -');
            difficultyLabel.classList.remove("hidden");
        }

        const taskHeaderMeta = document.getElementById("task-header-meta");
        if (taskHeaderMeta) {
            const qInfo =
                total && index != null
                    ? wt('s1.question_n_of_total', 'Вопрос {n} из {total}').replace('{n}', index + 1).replace('{total}', total)
                    : wt('s1.question_label', 'Вопрос');
            const iterInfo = wt('s1.iteration_label', 'Итерация {iter}').replace('{iter}', task.iteration ?? '?');
            taskHeaderMeta.textContent = `${qInfo} - ${iterInfo}`;
            taskHeaderMeta.classList.remove("hidden");
        }
        if (taskProgressMetaEl) {
            const metaParts = [];
            if (total && index != null) metaParts.push(wt('s1.task_n_of_total', 'Задание {n} из {total}').replace('{n}', index + 1).replace('{total}', total));
            metaParts.push(wt('s1.iteration_label', 'Итерация {iter}').replace('{iter}', task.iteration ?? '?'));
            taskProgressMetaEl.textContent = metaParts.join(" • ");
            taskProgressMetaEl.textContent = "";
            taskProgressMetaEl.classList.add("hidden");
        }

        if (taskHeaderBlock) {
            taskHeaderBlock.classList.toggle("hidden", !shouldShowInstructionBlock || shouldInlineClickInstruction);
        }
        if (taskHeaderLabelEl) {
            taskHeaderLabelEl.textContent = shouldShowInstructionBlock ? wt('s1.task_instruction_label', 'Что нужно сделать') : wt('s1.task_type_default', 'Задание');
        }
        if (shouldShowInstructionBlock) {
            if (titleEl) titleEl.textContent = normalizedQuestion;
            if (metaEl) {
                metaEl.textContent = instructionMeta;
                metaEl.classList.toggle("hidden", !instructionMeta);
            }
            if (descEl) {
                descEl.textContent = instructionDescription;
                descEl.classList.toggle("hidden", !instructionDescription);
            }
            if (refEl) refEl.textContent = "";
        } else {
            if (metaEl) metaEl.classList.toggle("hidden", !headerMeta);
            if (descEl) descEl.classList.toggle("hidden", !headerDescription);
        }

        scheduleHeaderTitleToggleSync();

        const percent = total > 0 ? Math.min(100, ((index + 1) / total) * 100) : 0;
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }

        const taskContent = document.getElementById("task-content");
        if (taskContent) {
            if (SessionState) SessionState.currentTaskChecked = false;
            if (SessionState) SessionState.currentEvaluationResult = null;
            if (SessionState) SessionState.pendingManualJudgement = false;
            UIHelpers.setCanGoNext(false);
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
                                if (UIHelpers && typeof UIHelpers.showStatus === "function") {
                                    UIHelpers.showStatus(
                                        "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0432\u0435\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438. \u041f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u044d\u043a\u0440\u0430\u043d \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
                                        "error"
                                    );
                                }
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
            } else if (!handled && taskType === "image_labeling" && typeof ImageLabelUI !== "undefined") {
                handled = true;
                ImageLabelUI.render(taskContent, task);
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
                        ImageLabelUI: typeof ImageLabelUI !== "undefined",
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
                renderUnsupportedTaskFallback(taskContent, taskType, task.task_id);
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
            const hasServerRestoredInput =
                !!(task && task.restored_user_input && typeof task.restored_user_input === "object");
            if (!hasServerRestoredInput && task && DraftStorage && SessionState && SessionState.sessionId) {
                const draftKey = buildTaskDraftStorageKey(task);
                const draft = draftKey ? DraftStorage.loadDraft(SessionState.sessionId, draftKey) : null;
                if (draft) {
                    setTimeout(() => {
                        const type = pickEffectiveTaskType(task);
                        restoreDraftToUI(type, draft);
                        UIHelpers.showStatus(
                            "\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442",
                            "info",
                            { dismissible: true, autoHideMs: 8000 }
                        );
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

    function restoreCheckedTaskState(task, result) {
        showEvaluationResult(result);
        if (!task || !result) return;
        const pendingUserJudgement = !!(
            result.details &&
            typeof result.details === "object" &&
            result.details.requires_user_judgement === true
        );
        if (SessionState) {
            SessionState.currentTaskChecked = !pendingUserJudgement;
            SessionState.currentEvaluationResult = result;
            SessionState.pendingManualJudgement = pendingUserJudgement;
        }

        const checkBtn = document.getElementById("check-answer-btn");
        if (checkBtn) {
            checkBtn.disabled = true;
            checkBtn.setAttribute("aria-disabled", "true");
            checkBtn.setAttribute("title", pendingUserJudgement ? wt('s1.check_pending_judgement', 'Сначала выберите итог проверки') : wt('s1.check_already_checked', 'Задание уже проверено'));
        }

        try {
            const taskType = pickEffectiveTaskType(task);
            const subtype = getTaskSubtype(task);

            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.applyCheckFeedback === "function") {
                TestUI.applyCheckFeedback(result);
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.applyCheckFeedback === "function") {
                SequenceUI.applyCheckFeedback(result);
            } else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.applyCheckFeedback === "function") {
                ImageLabelUI.applyCheckFeedback(result);
            } else if (taskType === "click") {
                if (subtype !== "error_detection" && typeof ClickUI !== "undefined" && typeof ClickUI.applyCheckFeedback === "function") {
                    ClickUI.applyCheckFeedback(result);
                }
            } else if (taskType === "draw" && typeof DrawUI !== "undefined" && typeof DrawUI.applyCheckFeedback === "function") {
                DrawUI.applyCheckFeedback(result);
            } else if (taskType === "open_answer" && typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.applyCheckFeedback === "function") {
                OpenAnswerUI.applyCheckFeedback(result);
            }
        } catch (e) {
            console.error("Failed to restore checked task state", e);
        }
    }

    return {
        renderTask: renderTask,
        getTaskSubtype: getTaskSubtype,
        getRawTaskType: getRawTaskType,
        isValidTaskType: isValidTaskType,
        pickEffectiveTaskType: pickEffectiveTaskType,
        showEvaluationResult: showEvaluationResult,
        restoreCheckedTaskState: restoreCheckedTaskState,
        restoreDraftToUI: restoreDraftToUI,
        restoreViewStateToUI: restoreViewStateToUI,
        getCurrentEffectiveTaskType: getCurrentEffectiveTaskType,
        isHandledByClickUI: isHandledByClickUI,
        currentTaskHandledByClickUI: currentTaskHandledByClickUI
    };
}));
