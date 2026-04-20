/**
 * ACTRA Test Task Editor (Multiple Choice)
 */

class TestEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task, this.moduleId, this.topicId, this.taskId, this.hasUnsavedChanges
        // are now inherited from BaseEditor

        // Test Editor specific fields
        this.questions = [];
        this.currentQuestionIndex = 0;
        this.DEFAULT_TEST_SETTINGS = {
            shuffle_questions: true,
            shuffle_answers: true,
            time_limit: null,
            passing_score: 70
        };

        this.toastContainer = document.getElementById('toast-container');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingTextEl = document.getElementById('loading-text');
        this.loadingCounter = 0;

        this.pendingOptionImageIndex = null;
        this.pendingImportData = null;
        this.pendingImportFile = null;
        this.pendingImportErrors = [];
        this.importMode = 'replace';
        this.initialSnapshot = null;
        this.isQuestionImageUploading = false;
        this.uploadingOptionImageIndex = null;
        this.pendingQuestionDeletion = null;
        this.questionDeletionUndoMs = 6000;
        this.init();
    }

    getImageRequestContext() {
        const meta = this.task?.task_data?.meta || {};
        return {
            module: meta.module || this.task?.metadata?.module || this.moduleId,
            topic: meta.topic || this.task?.metadata?.topic || this.topicId,
            task: this.task?.metadata?.id || meta.id || this.task?.task_data?.meta?.id || this.taskId,
        };
    }

    buildImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('/api/assets/') || path.startsWith('/api/editor/image') || path.startsWith('/api/local-image')) {
            return path;
        }
        const params = new URLSearchParams({ path });
        const ctx = this.getImageRequestContext();
        if (ctx.module) params.set('module', ctx.module);
        if (ctx.topic) params.set('topic', ctx.topic);
        if (ctx.task) params.set('task', ctx.task);
        return `/api/editor/image?${params.toString()}`;
    }

    buildAssetImageUrl(assetId) {
        if (!assetId) return '';
        return `/api/editor/image?asset_id=${encodeURIComponent(assetId)}`;
    }

    normalizeImageReference(raw, explicitAssetUrl = null, explicitAssetId = null) {
        const fallbackAssetUrl = explicitAssetUrl != null ? String(explicitAssetUrl).trim() : "";
        const fallbackAssetId = explicitAssetId != null ? String(explicitAssetId).trim() : "";

        if (!raw && raw !== 0) {
            return {
                path: null,
                asset_url: fallbackAssetUrl || null,
                asset_id: fallbackAssetId || null,
            };
        }

        if (typeof raw === "string") {
            const value = raw.trim();
            if (!value) {
                return {
                    path: null,
                    asset_url: fallbackAssetUrl || null,
                    asset_id: fallbackAssetId || null,
                };
            }
            if (fallbackAssetUrl || fallbackAssetId) {
                return {
                    path: value,
                    asset_url: fallbackAssetUrl || null,
                    asset_id: fallbackAssetId || null,
                };
            }
            if (value.startsWith("/api/assets/") || /^(https?:|data:)/i.test(value)) {
                return {
                    path: null,
                    asset_url: value,
                    asset_id: null,
                };
            }
            return {
                path: value,
                asset_url: null,
                asset_id: null,
            };
        }

        if (typeof raw !== "object") {
            return {
                path: null,
                asset_url: fallbackAssetUrl || null,
                asset_id: fallbackAssetId || null,
            };
        }

        const nested = raw.image && typeof raw.image === "object" ? raw.image : null;
        const path = String(
            raw.path ??
            raw.image_path ??
            (typeof raw.image === "string" ? raw.image : null) ??
            raw.src ??
            nested?.path ??
            nested?.image_path ??
            nested?.src ??
            ""
        ).trim();
        const asset_url = String(
            fallbackAssetUrl || (
                raw.asset_url ??
                raw.image_asset_url ??
                raw.image_url ??
                raw.url ??
                nested?.asset_url ??
                nested?.image_asset_url ??
                nested?.image_url ??
                nested?.url ??
                ""
            )
        ).trim();
        const asset_id = String(
            fallbackAssetId || (
                raw.asset_id ??
                raw.image_asset_id ??
                nested?.asset_id ??
                nested?.image_asset_id ??
                ""
            )
        ).trim();

        return {
            path: path || null,
            asset_url: asset_url || null,
            asset_id: asset_id || null,
        };
    }

    resolveImageSource(path, assetUrl, assetId) {
        const normalized = this.normalizeImageReference(path, assetUrl, assetId);
        if (normalized.asset_url) return normalized.asset_url;
        if (normalized.asset_id) return this.buildAssetImageUrl(normalized.asset_id);
        return this.buildImageUrl(normalized.path);
    }

    createEmptyQuestion() {
        return {
            id: Date.now(),
            text: "Новый вопрос",
            options: [
                { text: "Вариант 1", is_correct: true, image_path: null, image_asset_id: null, image_asset_url: null },
                { text: "Вариант 2", is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null }
            ],
            settings: { all_correct_required: true, allow_partial_credit: false },
            explanation: "",
            image: null,
            image_asset_id: null,
            image_asset_url: null,
            images: []
        };
    }

    normalizeTestSettings(rawSettings = {}) {
        return {
            shuffle_questions: rawSettings.shuffle_questions !== false,
            shuffle_answers: rawSettings.shuffle_answers !== false,
            time_limit: rawSettings.time_limit ?? null,
            passing_score: Number.isFinite(rawSettings.passing_score)
                ? rawSettings.passing_score
                : this.DEFAULT_TEST_SETTINGS.passing_score
        };
    }

    normalizeAnswersToOptions(answers) {
        if (!Array.isArray(answers) || answers.length === 0) {
            return this.createEmptyQuestion().options;
        }

        return answers.map((answer) => ({
            ...(() => {
                const ref = this.normalizeImageReference(answer);
                return {
                    image_path: ref.path,
                    image_asset_id: ref.asset_id,
                    image_asset_url: ref.asset_url,
                };
            })(),
            text: answer?.text ?? "",
            is_correct: Boolean(answer?.correct),
        }));
    }

    ensureQuestionShape(question, fallbackIndex = 0) {
        if (!question || typeof question !== "object") {
            return this.createEmptyQuestion();
        }

        const hasBackendAnswers = Array.isArray(question.answers);
        const optionsSource = hasBackendAnswers ? question.answers : question.options;
        const options = Array.isArray(optionsSource)
            ? optionsSource.map((opt) => {
                const ref = this.normalizeImageReference(opt);
                return {
                    text: opt?.text ?? "",
                    is_correct: Boolean(opt?.is_correct ?? opt?.correct),
                    image_path: ref.path,
                    image_asset_id: ref.asset_id,
                    image_asset_url: ref.asset_url
                };
            })
            : this.createEmptyQuestion().options;

        const questionRef = this.normalizeImageReference(question);

        return {
            id: Number.isFinite(question.id) ? question.id : fallbackIndex,
            text: question.text ?? "",
            options: options.length ? options : this.createEmptyQuestion().options,
            settings: {
                all_correct_required: question.settings?.all_correct_required !== false,
                allow_partial_credit: Boolean(question.settings?.allow_partial_credit)
            },
            explanation: question.explanation ?? "",
            image: questionRef.path,
            image_asset_id: questionRef.asset_id,
            image_asset_url: questionRef.asset_url,
            images: Array.isArray(question.images) ? [...question.images] : []
        };
    }

    deserializeQuestions(rawQuestions) {
        if (!Array.isArray(rawQuestions)) {
            return [];
        }

        const containsBackendAnswers = rawQuestions.some((q) => Array.isArray(q?.answers));
        const source = containsBackendAnswers ? this.normalizeQuestionsFromBackend(rawQuestions) : rawQuestions;
        return source.map((q, idx) => this.ensureQuestionShape(q, idx));
    }

    normalizeQuestionsFromBackend(backendQuestions) {
        if (!Array.isArray(backendQuestions)) {
            return [];
        }

        return backendQuestions.map((question, idx) => {
            const questionRef = this.normalizeImageReference(question);
            return {
                id: Number.isFinite(question?.id) ? question.id : idx,
                text: question?.text ?? "",
                options: this.normalizeAnswersToOptions(question?.answers),
                settings: {
                    all_correct_required: true,
                    allow_partial_credit: false
                },
                explanation: question?.explanation ?? "",
                image: questionRef.path,
                image_asset_id: questionRef.asset_id,
                image_asset_url: questionRef.asset_url,
                images: Array.isArray(question?.images) ? [...question.images] : []
            };
        });
    }

    buildBackendContent() {
        const originalContent = this.task?.task_data?.content ?? {};
        const testType = originalContent.test_type || "multiple_choice";
        const testSettings = this.normalizeTestSettings(originalContent.settings ?? this.DEFAULT_TEST_SETTINGS);

        const questions = this.questions.map((question, idx) => {
            const answers = (question.options || []).map((opt) => {
                const ref = this.normalizeImageReference(opt);
                return {
                    text: (opt.text ?? "").trim(),
                    correct: Boolean(opt.is_correct),
                    image_path: ref.path,
                    image_asset_id: ref.asset_id,
                    image_asset_url: ref.asset_url
                };
            });
            const options = (question.options || []).map((opt) => {
                const ref = this.normalizeImageReference(opt);
                return {
                    text: (opt.text ?? "").trim(),
                    is_correct: Boolean(opt.is_correct),
                    image_path: ref.path,
                    image_asset_id: ref.asset_id,
                    image_asset_url: ref.asset_url
                };
            });

            const questionRef = this.normalizeImageReference({
                image: question.image,
                image_asset_id: question.image_asset_id,
                image_asset_url: question.image_asset_url,
            });

            const payload = {
                id: Number.isFinite(question.id) ? question.id : idx,
                text: (question.text ?? "").trim(),
                answers,
                options
            };

            if (questionRef.path) {
                payload.image = questionRef.path;
                payload.image_path = questionRef.path;
            }
            if (questionRef.asset_id) {
                payload.image_asset_id = questionRef.asset_id;
            }
            if (questionRef.asset_url) {
                payload.image_asset_url = questionRef.asset_url;
            }
            if (Array.isArray(question.images) && question.images.length) {
                payload.images = question.images.slice();
            }
            if (question.explanation) {
                payload.explanation = question.explanation;
            }

            return payload;
        });

        return {
            test_type: testType,
            settings: testSettings,
            questions
        };
    }

    async init() {
        await this.initTaskFromUrlContext();
        this.setupEventListeners();
    }

    getDifficultyAuthoringMountPoint() {
        return document.querySelector('aside .p-6.space-y-8');
    }

    getDifficultyAuthoringLayoutVariant() {
        return 'sidebar-compact';
    }

    getDifficultyAuthoringInsertMode() {
        return 'append';
    }

    // ===== BASEEDITOR ABSTRACT METHODS IMPLEMENTATION =====

    /**
     * Called after task is loaded from backend (BaseEditor hook)
     * Replaces the old loadTask() method
     */
    onTaskLoaded() {
        // Load and normalize questions from task data
        const rawQuestions = this.task?.task_data?.content?.questions || [];
        this.questions = this.deserializeQuestions(rawQuestions);
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });

        // Ensure at least one question exists
        if (this.questions.length === 0) {
            this.questions.push(this.createEmptyQuestion());
        }

        // Render UI
        this.renderUI();
    }

    determineQuestionType(question) {
        if (!question || !Array.isArray(question.options)) {
            return { type: 'unknown', label: 'Нет данных', tone: 'text-text-disabled' };
        }
        const correctCount = question.options.filter((opt) => opt.is_correct).length;
        if (correctCount === 0) {
            return { type: 'invalid', label: 'Нет правильных ответов', tone: 'text-error-text' };
        }
        if (correctCount === 1) {
            return { type: 'single_choice', label: 'Одиночный выбор', tone: 'text-success-text' };
        }
        return { type: 'multiple_choice', label: 'Множественный выбор', tone: 'text-info-text' };
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    getTaskDisplayName() {
        return String(
            this.task?.metadata?.name
            || this.task?.task_data?.meta?.name
            || this.taskNameParam
            || 'Новый тест'
        ).trim();
    }

    summarizeQuestion(question) {
        const options = Array.isArray(question?.options) ? question.options : [];
        const filledOptions = options.filter(
            (opt) => String(opt?.text || '').trim() || opt?.image_path || opt?.image_asset_id || opt?.image_asset_url
        ).length;
        const correctCount = options.filter((opt) => opt?.is_correct).length;
        const hasQuestionText = Boolean(String(question?.text || '').trim());
        const isReady = hasQuestionText && options.length >= 2 && filledOptions >= 2 && correctCount >= 1;
        const isEmpty = !hasQuestionText && filledOptions === 0 && correctCount === 0;

        let state = 'partial';
        let meta = `${filledOptions}/${options.length || 0} вариантов заполнено`;

        if (isReady) {
            state = 'ready';
            meta = correctCount > 1
                ? `${correctCount} правильных ответа`
                : '1 правильный ответ';
        } else if (isEmpty) {
            state = 'empty';
            meta = 'Заполните вопрос и минимум два варианта';
        } else if (correctCount === 0) {
            meta = 'Отметьте правильный вариант';
        }

        return { state, meta, correctCount, filledOptions };
    }

    updateEditorChrome() {
        const taskName = this.getTaskDisplayName() || 'Новый тест';
        const currentLabel = `Вопрос ${this.currentQuestionIndex + 1} из ${this.questions.length}`;
        const questionCount = this.questions.length;
        const countLabel = questionCount === 1 ? '1 вопрос' : `${questionCount} вопросов`;

        const taskNameNodes = ['#task-name-caption', '#sidebar-task-name'];
        taskNameNodes.forEach((selector) => {
            const node = document.querySelector(selector);
            if (node) {
                node.textContent = taskName;
                if (selector === '#task-name-caption') {
                    node.title = taskName;
                }
            }
        });

        const activeQuestion = document.querySelector('#active-question-caption');
        if (activeQuestion) {
            activeQuestion.textContent = currentLabel;
        }

        const badge = document.querySelector('#question-count-badge');
        if (badge) {
            badge.textContent = countLabel;
        }
    }

    updateAnswerTypeDisplay() {
        const display = document.querySelector('#answer-type-display');
        if (!display) return;
        const q = this.questions[this.currentQuestionIndex];
        const { label, tone } = this.determineQuestionType(q);
        display.textContent = label;
        display.classList.remove('text-success-text', 'text-info-text', 'text-error-text', 'text-text-disabled');
        display.classList.add(tone);
    }

    renderUI() {
        if (!this.task) return;

        this.renderQuestionList();
        this.renderCurrentQuestion();
        this.updateEditorChrome();
        this.initialSnapshot = this.captureSnapshot();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
        this.autoResizeQuestionTextarea();
        this.updateUndoRedoButtons();
    }

    captureSnapshot() {
        try {
            return JSON.stringify(this.buildBackendContent());
        } catch (error) {
            console.error('Failed to snapshot content', error);
            return null;
        }
    }

    /**
     * Capture state for Autosave and Undo/Redo.
     * Returns backend-format content + currentQuestionIndex.
     * @returns {Object} State object
     */
    captureState() {
        const json = this.captureSnapshot();
        const state = json ? JSON.parse(json) : null;
        if (state) {
            state.currentQuestionIndex = this.currentQuestionIndex;
            state.taskSettings = this.captureTaskSettingsState();
        }
        return state;
    }

    /**
     * Restore state for Autosave and Undo/Redo.
     * Handles both backend-format (answers[].correct) and editor-format (options[].is_correct)
     * via deserializeQuestions. Also restores settings and currentQuestionIndex.
     * @param {Object} state - State object to restore
     */
    restoreState(state) {
        if (!state) return;
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });

        // Restore settings
        if (state.settings && this.task?.task_data?.content) {
            const mergedSettings = { ...this.DEFAULT_TEST_SETTINGS, ...state.settings };
            this.task.task_data.content.settings = mergedSettings;
        }
        if (Object.prototype.hasOwnProperty.call(state, 'taskSettings')) {
            this.restoreTaskSettingsState(state.taskSettings);
        }

        // Restore questions (deserialize handles both backend and editor format)
        if (state.questions) {
            this.questions = this.deserializeQuestions(state.questions);
        } else {
            this.questions = [this.createEmptyQuestion()];
        }

        this.currentQuestionIndex = Number.isFinite(state.currentQuestionIndex)
            ? state.currentQuestionIndex
            : 0;
        this.renderUI();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[TestEditor] difficulty authoring refresh failed', error);
        });
        this.markUnsaved();
    }

    markUnsavedChanges() {
        this.markUnsaved();
    }

    autoResizeQuestionTextarea() {
        const textarea = document.querySelector('#question-textarea');
        if (!textarea) return;
        textarea.style.height = 'auto';
        const minHeight = 72;
        const newHeight = Math.max(textarea.scrollHeight, minHeight);
        textarea.style.height = `${newHeight}px`;
    }

    syncQuestionImageBusyState() {
        const mediaDock = document.querySelector('.question-media-dock');
        const uploadBtn = document.querySelector('#upload-image-btn');
        const removeBtn = document.querySelector('#remove-question-image-btn');
        const isBusy = Boolean(this.isQuestionImageUploading);

        if (mediaDock) {
            mediaDock.classList.toggle('is-uploading', isBusy);
        }
        if (uploadBtn) {
            uploadBtn.disabled = isBusy;
            uploadBtn.classList.toggle('is-busy', isBusy);
        }
        if (removeBtn) {
            removeBtn.disabled = isBusy;
        }
    }

    syncOptionImageBusyState() {
        const busyIndex = Number.isInteger(this.uploadingOptionImageIndex)
            ? this.uploadingOptionImageIndex
            : -1;

        document.querySelectorAll('#options-container .option-row').forEach((row, index) => {
            const isBusy = index === busyIndex;
            row.classList.toggle('is-uploading', isBusy);

            const uploadBtn = row.querySelector('.upload-option-image');
            const removeBtn = row.querySelector('.remove-option-image');
            const deleteBtn = row.querySelector('.delete-option');

            if (uploadBtn) {
                uploadBtn.disabled = isBusy;
                uploadBtn.classList.toggle('is-busy', isBusy);
            }
            if (removeBtn) {
                removeBtn.disabled = isBusy;
            }
            if (deleteBtn) {
                deleteBtn.disabled = isBusy;
            }
        });
    }

    renderQuestionList() {
        const list = document.querySelector('#question-list');
        if (!list) return;
        list.innerHTML = '';

        this.questions.forEach((q, index) => {
            const isActive = this.currentQuestionIndex === index;
            const summary = this.summarizeQuestion(q);
            const item = document.createElement('div');
            item.className = `question-nav-item ${isActive ? 'is-active' : ''}`;
            item.dataset.questionIndex = String(index);

            const questionTitle = (q.text || `Вопрос ${index + 1}`).trim();
            const preview = questionTitle.length > 42 ? `${questionTitle.slice(0, 42).trim()}…` : questionTitle || `Вопрос ${index + 1}`;
            const safePreview = this.escapeHtml(preview);
            const safeMeta = this.escapeHtml(summary.meta);
            const questionIndex = String(index + 1).padStart(2, '0');
            const deleteDisabled = this.questions.length <= 1;

            item.innerHTML = `
                <button type="button" class="question-nav-item__select" aria-current="${isActive ? 'true' : 'false'}" title="Открыть вопрос ${index + 1}">
                    <span class="question-nav-item__index">${questionIndex}</span>
                    <span class="question-nav-item__body">
                        <span class="question-nav-item__title">${safePreview}</span>
                        <span class="question-nav-item__meta">${safeMeta}</span>
                    </span>
                    <span class="question-nav-item__state is-${summary.state}"></span>
                </button>
                <button type="button" class="question-nav-item__delete" title="Удалить вопрос ${index + 1}" aria-label="Удалить вопрос ${index + 1}" ${deleteDisabled ? 'disabled' : ''}>
                    <span class="material-symbols-outlined text-[16px]">delete</span>
                </button>
            `;

            const selectBtn = item.querySelector('.question-nav-item__select');
            if (selectBtn) {
                selectBtn.onclick = () => {
                    this.currentQuestionIndex = index;
                    this.renderUI();
                };
            }

            const deleteBtn = item.querySelector('.question-nav-item__delete');
            if (deleteBtn) {
                deleteBtn.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.deleteQuestion(index);
                };
            }

            list.appendChild(item);
        });
    }

    resolveCurrentQuestionIndexAfterDelete(deletedIndex) {
        if (!this.questions.length) {
            return 0;
        }
        if (deletedIndex < this.currentQuestionIndex) {
            return Math.max(0, this.currentQuestionIndex - 1);
        }
        if (deletedIndex === this.currentQuestionIndex) {
            return Math.min(deletedIndex, this.questions.length - 1);
        }
        return Math.min(this.currentQuestionIndex, this.questions.length - 1);
    }

    dismissToastById(toastId) {
        if (!toastId) return;
        const toast = document.getElementById(toastId);
        if (!toast) return;
        if (typeof toast.__cleanup === 'function') {
            toast.__cleanup();
            return;
        }
        toast.remove();
    }

    finalizePendingQuestionDeletion({ dismissToast = false, silent = false } = {}) {
        const pending = this.pendingQuestionDeletion;
        if (!pending) {
            return false;
        }
        if (pending.timerId) {
            clearTimeout(pending.timerId);
        }
        if (dismissToast && pending.toastId) {
            this.dismissToastById(pending.toastId);
        }
        this.pendingQuestionDeletion = null;
        if (!silent) {
            this.updateUndoRedoButtons();
        }
        return true;
    }

    restorePendingQuestionDeletion({ showToast = true } = {}) {
        const pending = this.pendingQuestionDeletion;
        if (!pending?.question) {
            return false;
        }

        if (pending.timerId) {
            clearTimeout(pending.timerId);
        }
        if (pending.toastId) {
            this.dismissToastById(pending.toastId);
        }

        const insertIndex = Math.max(0, Math.min(pending.index, this.questions.length));
        this.questions.splice(insertIndex, 0, pending.question);

        const restoredActiveIndex = this.questions.findIndex((question) => question?.id === pending.activeQuestionId);
        this.currentQuestionIndex = restoredActiveIndex !== -1 ? restoredActiveIndex : insertIndex;

        this.pendingQuestionDeletion = null;
        this.renderUI();
        this.markUnsavedChanges();
        this.updateUndoRedoButtons();

        if (showToast) {
            this.showToast('Вопрос восстановлен', 'success');
        }
        return true;
    }

    deleteQuestion(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) {
            return;
        }
        if (this.questions.length <= 1) {
            this.showToast('Нужен хотя бы один вопрос', 'warning');
            return;
        }

        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });

        const activeQuestionId = this.questions[this.currentQuestionIndex]?.id ?? null;
        const [removedQuestion] = this.questions.splice(index, 1);
        if (!removedQuestion) {
            return;
        }

        this.currentQuestionIndex = this.resolveCurrentQuestionIndexAfterDelete(index);

        const toastId = `question-delete-toast-${Date.now()}`;
        const timerId = setTimeout(() => {
            this.finalizePendingQuestionDeletion({ dismissToast: false });
        }, this.questionDeletionUndoMs);

        this.pendingQuestionDeletion = {
            question: removedQuestion,
            index,
            activeQuestionId: activeQuestionId || removedQuestion.id,
            toastId,
            timerId,
        };

        this.renderUI();
        this.markUnsavedChanges();
        this.updateUndoRedoButtons();
        this.showToast(`Вопрос ${index + 1} удалён`, 'warning', this.questionDeletionUndoMs, {
            toastId,
            actionLabel: 'Отменить',
            timerSeconds: Math.ceil(this.questionDeletionUndoMs / 1000),
            onAction: () => this.restorePendingQuestionDeletion({ showToast: true }),
        });
    }

    renderCurrentQuestion() {
        const q = this.questions[this.currentQuestionIndex];
        if (!q) return;

        // Question Text
        const textarea = document.querySelector('#question-textarea');
        if (textarea) {
            textarea.value = q.text || "";
            this.autoResizeQuestionTextarea();
        }

        // Image
        const img = document.querySelector('#question-image');
        const thumb = document.querySelector('#question-image-thumb');
        const uploadBtn = document.querySelector('#upload-image-btn');
        const removeBtn = document.querySelector('#remove-question-image-btn');
        const mediaDock = document.querySelector('.question-media-dock');
        const textareaRoot = document.querySelector('#question-textarea');
        const questionImageSrc = this.resolveImageSource(q.image, q.image_asset_url, q.image_asset_id);
        const hasQuestionImage = Boolean(questionImageSrc);

        if (img && thumb) {
            if (hasQuestionImage) {
                img.src = questionImageSrc;
                thumb.classList.remove('hidden');
            } else {
                img.src = '';
                thumb.classList.add('hidden');
            }
        }

        if (removeBtn) {
            removeBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.clearQuestionImage();
            };
        }

        if (mediaDock) {
            mediaDock.classList.toggle('has-image', hasQuestionImage);
        }

        if (textareaRoot) {
            textareaRoot.classList.toggle('has-question-image', hasQuestionImage);
        }

        if (uploadBtn) {
            const icon = uploadBtn.querySelector('.material-symbols-outlined');
            const label = uploadBtn.querySelector('.question-media-trigger__label');
            if (hasQuestionImage) {
                uploadBtn.classList.remove('hidden');
                uploadBtn.title = 'Заменить изображение вопроса';
                uploadBtn.setAttribute('aria-label', 'Заменить изображение вопроса');
                if (icon) icon.textContent = 'photo_library';
                if (label) label.textContent = 'Заменить';
            } else {
                uploadBtn.classList.remove('hidden');
                uploadBtn.title = 'Добавить изображение к вопросу';
                uploadBtn.setAttribute('aria-label', 'Добавить изображение к вопросу');
                if (icon) icon.textContent = 'add_photo_alternate';
                if (label) label.textContent = 'Фото';
            }
        }

        this.syncQuestionImageBusyState();

        // Options
        this.renderOptions();

        const feedback = document.querySelector('#explanation-textarea');
        if (feedback) {
            feedback.value = q.explanation || "";
        }

        this.updateAnswerTypeDisplay();
        this.updateEditorChrome();
    }

    renderOptions() {
        const container = document.querySelector('#options-container');
        if (!container) return;
        container.innerHTML = '';

        const q = this.questions[this.currentQuestionIndex];
        q.options = q.options || [];

        const optionImageInput = document.querySelector('#option-image-input');

        q.options.forEach((opt, index) => {
            const div = document.createElement('div');
            div.className = `group option-row ${opt.is_correct ? 'is-correct' : ''}`;

            const label = String.fromCharCode(65 + index); // A, B, C...
            const optionLabel = `вариант ${label}`;
            const statusLabel = opt.is_correct ? 'Правильный' : 'Не выбран';
            const optionImageSrc = this.resolveImageSource(opt.image_path, opt.image_asset_url, opt.image_asset_id);

            div.innerHTML = `
                <button type="button" class="option-letter" aria-pressed="${opt.is_correct ? 'true' : 'false'}" title="Отметить ${optionLabel} как правильный">${label}</button>
                <div class="option-row__main">
                    <div class="option-row__content">
                        <div class="option-row__toolbar">
                            <div class="option-row__toolbar-meta">
                                <span class="option-row__status ${opt.is_correct ? 'is-correct' : ''}">${statusLabel}</span>
                                <span class="option-row__toolbar-label">Ответ</span>
                            </div>
                            <div class="option-row__toolbar-actions">
                                <button class="delete-option option-row__delete-btn icon-button-muted border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error transition-all active:scale-95" title="Удалить ${optionLabel}" aria-label="Удалить ${optionLabel}">
                                    <span class="material-symbols-outlined text-[18px]">delete</span>
                                    <span>Удалить</span>
                                </button>
                            </div>
                        </div>
                        <textarea class="option-row__textarea rounded-md border-border-subtle bg-surface-1 text-sm focus:border-primary focus:ring-primary shadow-sm focus:shadow-md transition-all resize-none"
                            placeholder="Введите текст варианта..." rows="1"></textarea>
                    </div>
                    <div class="option-row__media">
                        ${optionImageSrc ? `
                            <div class="option-row__media-frame option-row__media-frame--filled relative">
                                <button class="upload-option-image option-row__media-preview-button"
                                    data-index="${index}" title="Заменить изображение ${optionLabel}" aria-label="Заменить изображение ${optionLabel}">
                                    <span class="option-row__media-preview w-full h-full rounded-lg border border-border-subtle shadow overflow-hidden bg-surface-1">
                                        <img src="${optionImageSrc}" alt="Изображение ${optionLabel}"
                                            class="w-full h-full object-cover" />
                                    </span>
                                    <span class="option-row__media-preview-caption">Заменить</span>
                                </button>
                                <button class="remove-option-image option-row__media-chip border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error transition shadow-sm"
                                    data-index="${index}" title="Удалить изображение ${optionLabel}" aria-label="Удалить изображение ${optionLabel}">
                                    <span class="material-symbols-outlined text-[14px] leading-none">close</span>
                                    <span class="option-row__media-chip-label">Убрать</span>
                                </button>
                            </div>
                        ` : `
                            <button class="upload-option-image option-row__media-empty-button"
                                    data-index="${index}" title="Добавить изображение к ${optionLabel}" aria-label="Добавить изображение к ${optionLabel}">
                                <span class="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                                <span class="option-row__media-empty-copy">
                                    <span class="option-row__media-empty-title">Добавить</span>
                                    <span class="option-row__media-empty-subtitle">изображение</span>
                                </span>
                            </button>
                        `}
                    </div>
                </div>
            `;

            const txt = div.querySelector('textarea');
            txt.value = opt.text || '';
            txt.oninput = (e) => {
                q.options[index].text = e.target.value;
                this.renderQuestionList();
                this.markUnsavedChanges();
            };

            const letterBtn = div.querySelector('.option-letter');
            const statusNode = div.querySelector('.option-row__status');
            const applyLetterState = () => {
                letterBtn.classList.toggle('correct', q.options[index].is_correct);
                letterBtn.setAttribute('aria-pressed', q.options[index].is_correct ? 'true' : 'false');
                div.classList.toggle('is-correct', q.options[index].is_correct);
                if (statusNode) {
                    statusNode.classList.toggle('is-correct', q.options[index].is_correct);
                    statusNode.textContent = q.options[index].is_correct ? 'Правильный' : 'Не выбран';
                }
            };
            applyLetterState();
            letterBtn.onclick = (e) => {
                e.preventDefault();
                q.options[index].is_correct = !q.options[index].is_correct;
                applyLetterState();
                this.updateAnswerTypeDisplay();
                this.renderQuestionList();
                this.markUnsavedChanges();
            };

            const uploadBtn = div.querySelector('.upload-option-image');
            if (uploadBtn && optionImageInput) {
                uploadBtn.onclick = (ev) => {
                    ev.preventDefault();
                    this.pendingOptionImageIndex = Number(uploadBtn.dataset.index);
                    optionImageInput.value = '';
                    optionImageInput.click();
                };
            }

            const removeBtn = div.querySelector('.remove-option-image');
            if (removeBtn) {
                removeBtn.onclick = (ev) => {
                    ev.preventDefault();
                    q.options[index].image_path = null;
                    q.options[index].image_asset_id = null;
                    q.options[index].image_asset_url = null;
                    this.renderOptions();
                    this.renderQuestionList();
                    this.markUnsavedChanges();
                };
            }

            div.querySelector('.delete-option').onclick = () => {
                q.options.splice(index, 1);
                this.renderOptions();
                this.renderQuestionList();
                this.markUnsavedChanges();
            };

            container.appendChild(div);
        });

        this.syncOptionImageBusyState();
        this.updateAnswerTypeDisplay();
    }

    addQuestion() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        this.questions.push(this.createEmptyQuestion());
        this.currentQuestionIndex = this.questions.length - 1;
        if (this.task) this.renderUI();
        this.markUnsavedChanges();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    addOption() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        const q = this.questions[this.currentQuestionIndex];
        if (!q) return;

        if (!Array.isArray(q.options)) {
            q.options = [];
        }
        q.options.push({ text: "", is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null });
        this.renderOptions();
        this.renderQuestionList();
        this.updateAnswerTypeDisplay();
        this.markUnsavedChanges();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    setupEventListeners() {
        // Back
        const backBtn = document.querySelector('header button');
        if (backBtn) backBtn.onclick = () => this.goBack();

        // Add Question
        const addQBtn = document.querySelector('#add-question-btn');
        if (addQBtn) addQBtn.onclick = () => this.addQuestion();

        // Add Option
        const addOptBtn = document.querySelector('#add-option-btn');
        if (addOptBtn) addOptBtn.onclick = () => this.addOption();

        // Image Upload
        const uploadBtn = document.querySelector('#upload-image-btn');
        const fileInput = document.querySelector('#image-upload-input');
        if (uploadBtn && fileInput) {
            uploadBtn.onclick = () => fileInput.click();
            fileInput.onchange = (e) => this.handleImageUpload(e);
        }

        const optionImageInput = document.querySelector('#option-image-input');
        if (optionImageInput) {
            optionImageInput.onchange = (e) => this.handleOptionImageUpload(e);
        }

        // Sync settings on change
        document.addEventListener('input', (e) => {
            const q = this.questions[this.currentQuestionIndex];
            if (!q) return;

            if (e.target.id === 'explanation-textarea') {
                q.explanation = e.target.value;
                this.markUnsavedChanges();
            }
            if (e.target.id === 'question-textarea') {
                q.text = e.target.value;
                this.renderQuestionList();
                this.updateEditorChrome();
                this.markUnsavedChanges();
                this.autoResizeQuestionTextarea();
            }
        });

        // Publish (Save)
        const publishBtn = document.querySelector('#save-task-btn');
        if (publishBtn) publishBtn.onclick = () => this.saveTask();

        // Import / Export
        const exportBtn = document.querySelector('#export-btn');
        if (exportBtn) exportBtn.onclick = () => this.exportTasks();

        const importBtn = document.querySelector('#import-btn');
        const importInput = document.querySelector('#import-input');
        const chooseImportBtn = document.querySelector('#choose-import-file-btn');
        if (importBtn) {
            importBtn.onclick = () => {
                this.resetImportModal();
                this.showImportModal(true);
            };
        }
        if (chooseImportBtn && importInput) {
            chooseImportBtn.onclick = () => importInput.click();
        }
        if (importInput) {
            importInput.onchange = (e) => this.handleImportFileSelected(e);
        }

        this.importPreview = document.querySelector('#import-question-preview');
        this.importErrorBox = document.querySelector('#import-error');
        this.importWarningBox = document.querySelector('#import-warning');
        this.importParserStatus = document.querySelector('#import-parser-status');
        this.importModeOptions = document.querySelectorAll('.import-mode-option');
        this.importModeRadios = document.querySelectorAll('input[name="import-mode"]');

        const importClose = document.querySelector('#import-modal-close');
        const importCancel = document.querySelector('#cancel-import-btn');
        const importConfirm = document.querySelector('#confirm-import-btn');
        if (importClose) importClose.onclick = () => this.hideImportModal();
        if (importCancel) importCancel.onclick = () => this.hideImportModal(true);
        if (importConfirm) importConfirm.onclick = () => this.confirmImport();
        if (this.importModeOptions.length) {
            this.importModeOptions.forEach((option) => {
                option.onclick = () => {
                    const input = option.querySelector('input[type="radio"]');
                    if (!input) return;
                    this.importMode = input.value;
                    this.updateImportModeUI();
                };
            });
        }
        this.updateImportModeUI();

        const clearButtons = [
            document.querySelector('#clear-test-btn'),
            document.querySelector('#clear-test-sidebar-btn'),
        ].filter(Boolean);
        clearButtons.forEach((button) => {
            button.onclick = () => this.clearTest();
        });

        const deleteButtons = [
            document.querySelector('#delete-test-btn'),
            document.querySelector('#delete-test-sidebar-btn'),
        ].filter(Boolean);
        deleteButtons.forEach((button) => {
            button.onclick = () => this.deleteTest();
        });
    }

    async exportTasks() {
        const payload = this.buildBackendContent();
        try {
            await this.withLoading('Экспорт теста...', async () => {
                const response = await fetch('/api/editor/test/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        questions: payload.questions,
                        settings: payload.settings,
                        test_type: payload.test_type,
                        filename: `${this.task?.metadata?.id || 'test'}.txt`
                    })
                });

                if (!response.ok) {
                    let errDetail = '';
                    try {
                        const errJson = await response.json();
                        errDetail = errJson.error;
                    } catch (_) {
                        // ignore
                    }
                    throw new Error(errDetail || 'Экспорт не удался');
                }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this.task?.metadata?.id || 'test'}.txt`;
                a.click();
                URL.revokeObjectURL(url);
                this.showToast('Файл с вопросами экспортирован', 'success');
            });
        } catch (error) {
            this.showToast(error.message || 'Ошибка экспорта', 'error');
        }
    }

    handleImportFileSelected(event) {
        const file = event.target.files[0];
        this.pendingImportFile = file || null;
        if (!file) return;

        const fileNameEl = document.querySelector('#import-file-name');
        const questionCountEl = document.querySelector('#import-question-count');
        const warningEl = this.importWarningBox;
        if (fileNameEl) {
            fileNameEl.textContent = file.name || '—';
        }
        if (questionCountEl) {
            questionCountEl.textContent = '—';
        }
        if (warningEl) {
            warningEl.classList.add('hidden');
        }

        const formData = new FormData();
        formData.append('file', file);

        this.withLoading('Проверка файла...', async () => {
            try {
                const data = await this.requestJson('/api/editor/test/import', {
                    method: 'POST',
                    body: formData
                });
                const importedQuestions = data.content?.questions || [];
                this.pendingImportData = importedQuestions;
                this.pendingImportErrors = data.errors || [];
                if (questionCountEl) {
                    questionCountEl.textContent = importedQuestions.length.toString();
                }
                if (warningEl) {
                    warningEl.classList.toggle('hidden', importedQuestions.length > 0);
                }
                this.renderImportPreview(importedQuestions);
                this.showImportError(this.pendingImportErrors[0]);
                this.setImportConfirmEnabled(importedQuestions.length > 0 && !this.pendingImportErrors.length);
            } catch (error) {
                this.pendingImportData = null;
                this.pendingImportErrors = [error.message || 'Не удалось прочитать файл'];
                this.showToast(error.message || 'Не удалось прочитать файл', 'error');
                this.renderImportPreview([]);
                this.showImportError(this.pendingImportErrors[0]);
                this.setImportConfirmEnabled(false);
            }
        }).finally(() => {
            event.target.value = '';
        });
    }

    confirmImport() {
        if (!this.pendingImportData) {
            this.showToast('Сначала выберите корректный файл', 'warning');
            return;
        }
        const normalized = this.deserializeQuestions(this.pendingImportData);
        if (this.importMode === 'append') {
            const q = this.questions || [];
            this.questions = q.concat(normalized);
        } else {
            this.questions = normalized.length ? normalized : [this.createEmptyQuestion()];
            this.currentQuestionIndex = 0;
        }
        this.renderUI();
        this.markUnsavedChanges();
        this.showToast(`Импортировано ${this.questions.length} вопросов`, 'success');
        this.pendingImportData = null;
        this.pendingImportFile = null;
        this.pendingImportErrors = [];
        this.showImportModal(false);
    }

    resetImportModal() {
        const fileNameEl = document.querySelector('#import-file-name');
        const questionCountEl = document.querySelector('#import-question-count');
        const warningEl = this.importWarningBox;
        if (fileNameEl) fileNameEl.textContent = '—';
        if (questionCountEl) questionCountEl.textContent = '—';
        if (warningEl) warningEl.classList.add('hidden');
        this.setImportConfirmEnabled(false);
        this.pendingImportData = null;
        this.pendingImportFile = null;
        this.pendingImportErrors = [];
        this.renderImportPreview([]);
        this.showImportError('');
        if (this.importParserStatus) {
            this.importParserStatus.textContent = 'Файл ещё не выбран';
            this.importParserStatus.classList.remove('text-success-text', 'bg-success-lighter', 'text-error', 'bg-error-lighter');
            this.importParserStatus.classList.add('bg-surface-2', 'text-text-secondary');
        }
        this.importMode = 'replace';
        this.updateImportModeUI();
    }

    setImportConfirmEnabled(enabled) {
        const confirmBtn = document.querySelector('#confirm-import-btn');
        if (!confirmBtn) return;
        if (enabled) {
            confirmBtn.disabled = false;
        } else {
            confirmBtn.disabled = true;
        }
    }

    showImportModal(show) {
        const modal = document.querySelector('#import-modal');
        if (!modal) return;
        if (show) {
            modal.classList.remove('hidden');
        } else {
            modal.classList.add('hidden');
        }
    }

    hideImportModal(clearPending = false) {
        if (clearPending) {
            this.pendingImportData = null;
            this.pendingImportFile = null;
            this.pendingImportErrors = [];
        }
        this.showImportModal(false);
    }

    updateImportModeUI() {
        if (!this.importModeOptions.length) return;
        this.importModeOptions.forEach((option) => {
            const input = option.querySelector('input[type="radio"]');
            if (!input) return;
            const isActive = input.value === this.importMode;
            option.dataset.active = isActive;
            if (isActive) {
                input.checked = true;
            }
        });
        const hint = document.querySelector('#import-mode-hint');
        if (hint) {
            hint.textContent =
                this.importMode === 'append'
                    ? 'Новые вопросы будут добавлены после существующих.'
                    : 'Текущие вопросы будут заменены импортированными данными.';
        }
    }

    renderImportPreview(questions) {
        if (!this.importPreview) return;
        this.importPreview.innerHTML = '';
        if (!questions || !questions.length) {
            const empty = document.createElement('p');
            empty.className = 'p-3 text-text-muted';
            empty.textContent = 'Файл ещё не выбран или не содержит вопросов';
            this.importPreview.appendChild(empty);
            return;
        }
        questions.slice(0, 10).forEach((q, idx) => {
            const item = document.createElement('div');
            item.className = 'p-3 flex flex-col gap-1 bg-surface-1';
            const title = document.createElement('div');
            title.className = 'text-xs font-semibold text-text-main';
            title.textContent = `Вопрос ${idx + 1}`;
            const text = document.createElement('div');
            text.className = 'text-xs text-text-secondary line-clamp-2';
            text.textContent = (q.text || '').trim() || '—';
            const answersInfo = document.createElement('div');
            answersInfo.className = 'text-[11px] text-text-muted';
            const answers = Array.isArray(q.answers) ? q.answers.length : 0;
            const correct = q.answers?.filter?.((a) => a.correct).length || 0;
            answersInfo.textContent = `${answers} вариантов, правильных: ${correct}`;
            item.appendChild(title);
            item.appendChild(text);
            item.appendChild(answersInfo);
            this.importPreview.appendChild(item);
        });
        if (questions.length > 10) {
            const more = document.createElement('div');
            more.className = 'p-2 text-[11px] text-center text-text-muted bg-surface-1 border-t border-border-subtle';
            more.textContent = `…и ещё ${questions.length - 10}`;
            this.importPreview.appendChild(more);
        }
    }

    showImportError(message) {
        if (!this.importErrorBox) return;
        if (this.importParserStatus) {
            if (message) {
                this.importParserStatus.textContent = 'Обнаружены ошибки при разборе';
                this.importParserStatus.classList.remove('bg-bg-secondary', 'text-text-secondary', 'bg-success-lighter', 'text-success');
                this.importParserStatus.classList.add('bg-error-lighter', 'text-error-text');
            } else if (this.pendingImportData && this.pendingImportData.length) {
                this.importParserStatus.textContent = 'Парсер отработал без ошибок';
                this.importParserStatus.classList.remove('bg-bg-secondary', 'text-text-secondary', 'bg-error-lighter', 'text-error-text');
                this.importParserStatus.classList.add('bg-success-lighter', 'text-success');
            } else {
                this.importParserStatus.textContent = 'Файл ещё не выбран';
                this.importParserStatus.classList.remove('bg-success-lighter', 'text-success', 'bg-error-lighter', 'text-error-text');
                this.importParserStatus.classList.add('bg-bg-secondary', 'text-text-secondary');
            }
        }
        if (message) {
            this.importErrorBox.textContent = message;
            this.importErrorBox.classList.remove('hidden');
        } else {
            this.importErrorBox.textContent = '';
            this.importErrorBox.classList.add('hidden');
        }
    }

    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('module', this.task.task_data.meta.module);
        formData.append('topic', this.task.task_data.meta.topic);
        formData.append('task', this.task.metadata.id);

        this.isQuestionImageUploading = true;
        this.syncQuestionImageBusyState();

        try {
            const data = await this.requestJson('/api/editor/upload-image', {
                method: 'POST',
                body: formData
            });

            const q = this.questions[this.currentQuestionIndex];
            q.image = data.path || null;
            q.image_asset_id = data.asset_id || null;
            q.image_asset_url = data.asset_url || null;
            this.isQuestionImageUploading = false;
            this.renderCurrentQuestion();
            this.showToast('Изображение обновлено', 'success');
            this.markUnsavedChanges();
        } catch (error) {
            console.error("Error uploading image:", error);
            this.showToast(error.message || 'Ошибка загрузки изображения', 'error');
        } finally {
            this.isQuestionImageUploading = false;
            this.syncQuestionImageBusyState();
        }
    }

    clearQuestionImage() {
        const q = this.questions[this.currentQuestionIndex];
        if (!q || (!q.image && !q.image_asset_id && !q.image_asset_url)) return;
        q.image = null;
        q.image_asset_id = null;
        q.image_asset_url = null;
        this.renderCurrentQuestion();
        this.showToast('Изображение удалено', 'info');
        this.markUnsavedChanges();
    }

    async handleOptionImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (this.pendingOptionImageIndex === null) return;
        const targetIndex = this.pendingOptionImageIndex;

        const currentQuestion = this.questions[this.currentQuestionIndex];
        if (!currentQuestion || !currentQuestion.options[targetIndex]) {
            this.pendingOptionImageIndex = null;
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('module', this.task.task_data.meta.module);
        formData.append('topic', this.task.task_data.meta.topic);
        formData.append('task', this.task.metadata.id);

        this.uploadingOptionImageIndex = targetIndex;
        this.syncOptionImageBusyState();

        try {
            const data = await this.requestJson('/api/editor/upload-image', {
                method: 'POST',
                body: formData
            });
            currentQuestion.options[targetIndex].image_path = data.path || null;
            currentQuestion.options[targetIndex].image_asset_id = data.asset_id || null;
            currentQuestion.options[targetIndex].image_asset_url = data.asset_url || null;
            this.uploadingOptionImageIndex = null;
            this.renderOptions();
            this.renderQuestionList();
            this.showToast('Изображение варианта обновлено', 'success');
            this.markUnsavedChanges();
        } catch (error) {
            this.showToast(error.message || 'Ошибка загрузки изображения варианта', 'error');
        } finally {
            this.uploadingOptionImageIndex = null;
            this.syncOptionImageBusyState();
            this.pendingOptionImageIndex = null;
            event.target.value = '';
        }
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        // Check minimum questions
        if (this.questions.length === 0) {
            this.showToast("Нужен хотя бы один вопрос", 'warning');
            return "Нужен хотя бы один вопрос";
        }

        // Validate each question
        for (let i = 0; i < this.questions.length; i++) {
            const q = this.questions[i];

            // Check question text
            if (!q.text || !q.text.trim()) {
                this.showToast(`Вопрос ${i + 1}: пустой текст`, 'warning');
                this.currentQuestionIndex = i;
                this.renderUI();
                return `Вопрос ${i + 1}: пустой текст`;
            }

            // Check minimum options
            if (!q.options || q.options.length < 2) {
                this.showToast(`Вопрос ${i + 1}: минимум два варианта ответа`, 'warning');
                this.currentQuestionIndex = i;
                this.renderUI();
                return `Вопрос ${i + 1}: минимум два варианта ответа`;
            }

            // Check option texts and correct answers
            let hasCorrect = false;
            for (let j = 0; j < q.options.length; j++) {
                const opt = q.options[j];
                // Allow empty text if image is present
                if ((!opt.text || !opt.text.trim()) && !opt.image_path && !opt.image_asset_id && !opt.image_asset_url) {
                    this.currentQuestionIndex = i;
                    this.renderUI();
                    return `Вопрос ${i + 1}, вариант ${j + 1}: пустой текст`;
                }
                if (opt.is_correct) hasCorrect = true;
            }

            // Check for at least one correct answer
            if (!hasCorrect) {
                this.currentQuestionIndex = i;
                this.renderUI();
                return `Вопрос ${i + 1}: отметьте правильный ответ`;
            }
        }

        return null; // Validation passed
    }

    /**
     * Build task data for saving to backend (BaseEditor abstract method)
     * @returns {Object} Task data object
     */
    buildTaskData() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        // Update task content with current questions
        this.task.task_data.content = this.buildBackendContent();
        return this.task.task_data;
    }

    /**
     * Called after task is successfully saved (BaseEditor hook)
     */
    onTaskSaved() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        // Update snapshot and save status
        this.initialSnapshot = this.captureSnapshot();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    performUndo() {
        if (this.restorePendingQuestionDeletion({ showToast: true })) {
            return;
        }
        super.performUndo();
    }

    updateUndoRedoButtons() {
        super.updateUndoRedoButtons();
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn && this.pendingQuestionDeletion) {
            undoBtn.disabled = false;
            undoBtn.title = 'Отменить удаление вопроса (Ctrl+Z)';
        }
    }

    async confirmAction({
        title,
        message,
        confirmText = 'Подтвердить',
        cancelText = 'Отмена',
        variant = 'warning'
    }) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.confirm === 'function') {
            return NotificationUI.confirm({ title, message, confirmText, cancelText, variant });
        }
        return window.confirm(message);
    }

    async clearTest() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        const clearConfirmed = await this.confirmAction({
            title: 'Очистить тест?',
            message: 'Все вопросы будут удалены. Это действие можно отменить только до сохранения.',
            confirmText: 'Очистить',
            cancelText: 'Отмена',
            variant: 'warning'
        });
        if (!clearConfirmed) {
            return;
        }
        this.questions = [this.createEmptyQuestion()];
        this.currentQuestionIndex = 0;
        this.renderUI();
        this.markUnsavedChanges();
        this.saveStateToHistory();
        this.showToast('Тест очищен', 'info');
    }

    async deleteTest() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        if (!this.task) return;
        const deleteConfirmed = await this.confirmAction({
            title: 'Удалить задание?',
            message: 'Это действие необратимо. Задание будет удалено целиком.',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'error'
        });
        if (!deleteConfirmed) {
            return;
        }

        if (!this.hasPersistedTask) {
            this.discardLocalTaskDraft({ successMessage: 'Черновик удалён' });
            return;
        }

        try {
            await this.withLoading('Удаление задания...', async () => {
                const m = this.task.task_data.meta.module;
                const t = this.task.task_data.meta.topic;
                const id = this.task.metadata.id;

                const response = await fetch(`/api/editor/task/${encodeURIComponent(m)}/${encodeURIComponent(t)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || 'Не удалось удалить задание');
                }
                this.showToast('Задание удалено', 'success');
                window.navigateWithTransition('/ui/editor');
            });
        } catch (err) {
            this.showToast(err.message || 'Ошибка удаления задания', 'error');
        }
    }

    showToast(message, variant = 'info', duration = 3500, options = {}) {
        if (!this.toastContainer) {
            console.log(`[Toast ${variant}]`, message);
            return;
        }
        const palette = {
            success: 'bg-success',
            error: 'bg-error',
            info: 'bg-surface-2',
            warning: 'bg-warning'
        };
        const icons = {
            success: 'check_circle',
            error: 'error',
            info: 'info',
            warning: 'warning'
        };
        const toast = document.createElement('div');
        toast.id = options.toastId || `test-editor-toast-${Date.now()}`;
        toast.className = `pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-text-on-dark flex items-center gap-3 transition transform ${palette[variant] || palette.info}`;
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-[18px]';
        icon.textContent = icons[variant] || icons.info;
        const text = document.createElement('span');
        text.className = 'flex-1 min-w-0';
        text.textContent = message;
        toast.appendChild(icon);
        toast.appendChild(text);

        if (Number.isFinite(options.timerSeconds) && options.timerSeconds > 0) {
            const timer = document.createElement('span');
            timer.className = 'text-xs font-semibold text-text-on-dark opacity-80';
            timer.textContent = `${Math.max(1, Math.ceil(options.timerSeconds))}с`;
            toast.appendChild(timer);

            let secondsLeft = Math.max(1, Math.ceil(options.timerSeconds));
            toast.__countdownInterval = setInterval(() => {
                secondsLeft -= 1;
                if (!toast.isConnected || secondsLeft <= 0) {
                    clearInterval(toast.__countdownInterval);
                    return;
                }
                timer.textContent = `${secondsLeft}с`;
            }, 1000);
        }

        if (options.actionLabel && typeof options.onAction === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'inline-flex items-center rounded-md border border-current/20 px-2 py-1 text-xs font-semibold hover:bg-scrim-soft transition-colors';
            actionBtn.textContent = options.actionLabel;
            actionBtn.onclick = () => {
                try {
                    options.onAction();
                } finally {
                    if (typeof toast.__cleanup === 'function') {
                        toast.__cleanup();
                    } else {
                        toast.remove();
                    }
                }
            };
            toast.appendChild(actionBtn);
        }

        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        this.toastContainer.appendChild(toast);

        toast.__cleanup = () => {
            if (toast.__cleanupDone) {
                return;
            }
            toast.__cleanupDone = true;
            if (toast.__hideTimer) {
                clearTimeout(toast.__hideTimer);
            }
            if (toast.__countdownInterval) {
                clearInterval(toast.__countdownInterval);
            }
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        };

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        if (duration > 0) {
            toast.__hideTimer = setTimeout(() => {
                toast.__cleanup();
            }, duration);
        }
        return toast;
    }

    toggleLoading(show, message = 'Загрузка...') {
        if (!this.loadingOverlay) return;
        if (show) {
            this.loadingCounter += 1;
            this.loadingOverlay.classList.remove('hidden');
            if (this.loadingTextEl) this.loadingTextEl.textContent = message;
        } else {
            this.loadingCounter = Math.max(0, this.loadingCounter - 1);
            if (this.loadingCounter === 0) {
                this.loadingOverlay.classList.add('hidden');
            }
        }
    }

    // Note: withLoading() is now inherited from BaseEditor

    async requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (err) {
                throw new Error('Некорректный ответ сервера');
            }
        }
        if (!response.ok) {
            throw new Error(data?.error || response.statusText || 'Ошибка запроса');
        }
        if (data && Object.prototype.hasOwnProperty.call(data, 'ok') && data.ok === false) {
            throw new Error(data.error || 'Ошибка запроса');
        }
        return data || {};
    }

    // ===== UNDO/REDO SUPPORT =====
    // captureState() and restoreState() are defined above (lines ~274-304)
    // and handle both backend/editor format, settings, and currentQuestionIndex.
}

document.addEventListener('DOMContentLoaded', () => {
    window.editor = new TestEditor();
});
