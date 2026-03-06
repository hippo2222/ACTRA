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
        this.init();
    }

    getTaskContext() {
        const meta = this.task?.task_data?.meta || {};
        return {
            module: meta.module || this.task?.metadata?.module,
            topic: meta.topic || this.task?.metadata?.topic,
            task: this.task?.metadata?.id || meta.id || this.task?.task_data?.meta?.id,
        };
    }

    buildImageUrl(path) {
        if (!path) return '';
        const params = new URLSearchParams({ path });
        const ctx = this.getTaskContext();
        if (ctx.module) params.set('module', ctx.module);
        if (ctx.topic) params.set('topic', ctx.topic);
        if (ctx.task) params.set('task', ctx.task);
        return `/api/editor/image?${params.toString()}`;
    }

    createEmptyQuestion() {
        return {
            id: Date.now(),
            text: "Новый вопрос",
            options: [
                { text: "Вариант 1", is_correct: true, image_path: null },
                { text: "Вариант 2", is_correct: false, image_path: null }
            ],
            settings: { all_correct_required: true, allow_partial_credit: false },
            explanation: "",
            image: null,
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
            text: answer?.text ?? "",
            is_correct: Boolean(answer?.correct),
            image_path: answer?.image_path ?? null
        }));
    }

    ensureQuestionShape(question, fallbackIndex = 0) {
        if (!question || typeof question !== "object") {
            return this.createEmptyQuestion();
        }

        const hasBackendAnswers = Array.isArray(question.answers);
        const optionsSource = hasBackendAnswers ? question.answers : question.options;
        const options = Array.isArray(optionsSource)
            ? optionsSource.map((opt) => ({
                text: opt?.text ?? "",
                is_correct: Boolean(opt?.is_correct ?? opt?.correct),
                image_path: opt?.image_path ?? opt?.image ?? null
            }))
            : this.createEmptyQuestion().options;

        return {
            id: Number.isFinite(question.id) ? question.id : fallbackIndex,
            text: question.text ?? "",
            options: options.length ? options : this.createEmptyQuestion().options,
            settings: {
                all_correct_required: question.settings?.all_correct_required !== false,
                allow_partial_credit: Boolean(question.settings?.allow_partial_credit)
            },
            explanation: question.explanation ?? "",
            image: question.image ?? question.image_path ?? null,
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

        return backendQuestions.map((question, idx) => ({
            id: Number.isFinite(question?.id) ? question.id : idx,
            text: question?.text ?? "",
            options: this.normalizeAnswersToOptions(question?.answers),
            settings: {
                all_correct_required: true,
                allow_partial_credit: false
            },
            explanation: question?.explanation ?? "",
            image: question?.image_path ?? null,
            images: Array.isArray(question?.images) ? [...question.images] : []
        }));
    }

    buildBackendContent() {
        const originalContent = this.task?.task_data?.content ?? {};
        const testType = originalContent.test_type || "multiple_choice";
        const testSettings = this.normalizeTestSettings(originalContent.settings ?? this.DEFAULT_TEST_SETTINGS);

        const questions = this.questions.map((question, idx) => {
            const answers = (question.options || []).map((opt) => ({
                text: (opt.text ?? "").trim(),
                correct: Boolean(opt.is_correct),
                image_path: opt.image_path || null
            }));

            const payload = {
                id: Number.isFinite(question.id) ? question.id : idx,
                text: (question.text ?? "").trim(),
                answers
            };

            if (question.image) {
                payload.image_path = question.image;
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
        const urlParams = new URLSearchParams(window.location.search);
        const moduleId = urlParams.get('module');
        const topicId = urlParams.get('topic');
        const taskId = urlParams.get('task');

        if (moduleId && topicId && taskId) {
            await this.loadTask(moduleId, topicId, taskId);
        } else {
            console.error("Missing task parameters in URL");
        }

        this.setupEventListeners();
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
        this.initialSnapshot = this.captureSnapshot();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
        this.autoResizeQuestionTextarea();
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

        // Restore settings
        if (state.settings && this.task?.task_data?.content) {
            const mergedSettings = { ...this.DEFAULT_TEST_SETTINGS, ...state.settings };
            this.task.task_data.content.settings = mergedSettings;
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

    renderQuestionList() {
        const list = document.querySelector('#question-list');
        if (!list) return;
        list.innerHTML = '';

        this.questions.forEach((q, index) => {
            const isActive = this.currentQuestionIndex === index;
            const btn = document.createElement('button');
            btn.className = `w-full text-left px-3 py-2 rounded-md text-sm transition-all flex items-center justify-between group animate-slide-up ${isActive ? 'bg-surface-1 text-primary font-semibold shadow-sm ring-1 ring-border-subtle translate-x-1' : 'text-text-secondary hover:bg-surface-1 hover:text-text-main hover:shadow-sm hover:translate-x-1'}`;

            const questionTitle = (q.text || `Вопрос ${index + 1}`).trim();
            const preview = questionTitle.length > 30 ? questionTitle.slice(0, 30).trim() + '…' : questionTitle || `Вопрос ${index + 1}`;

            btn.innerHTML = `
                <span class="truncate">${preview}</span>
                ${isActive ? '<span class="w-1.5 h-1.5 rounded-full bg-primary shrink-0"></span>' : ''}
            `;

            btn.onclick = () => {
                this.currentQuestionIndex = index;
                this.renderUI();
            };

            list.appendChild(btn);
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

        if (img && thumb) {
            if (q.image) {
                img.src = this.buildImageUrl(q.image);
                thumb.classList.remove('hidden');
                if (uploadBtn) uploadBtn.classList.add('hidden');
            } else {
                img.src = '';
                thumb.classList.add('hidden');
                if (uploadBtn) uploadBtn.classList.remove('hidden');
            }
        }

        // Options
        this.renderOptions();

        // Settings
        const allCorrect = document.querySelector('#all-correct-check');
        const partialCredit = document.querySelector('#partial-credit-check');
        const feedback = document.querySelector('#explanation-textarea');

        if (allCorrect) {
            allCorrect.checked = q.settings?.all_correct_required !== false;
            allCorrect.onchange = () => {
                q.settings.all_correct_required = allCorrect.checked;
                this.markUnsavedChanges();
            };
        }
        if (partialCredit) {
            partialCredit.checked = q.settings?.allow_partial_credit === true;
            partialCredit.onchange = () => {
                q.settings.allow_partial_credit = partialCredit.checked;
                this.markUnsavedChanges();
            };
        }
        if (feedback) {
            feedback.value = q.explanation || "";
        }

        this.updateAnswerTypeDisplay();
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
            div.className = 'flex items-start gap-3 group option-row';

            const label = String.fromCharCode(65 + index); // A, B, C...

            div.innerHTML = `
                <button type="button" class="option-letter mt-2 shrink-0 rounded-full w-8 h-8 border text-xs font-bold flex items-center justify-center transition-all">${label}</button>
                <div class="flex-1 flex items-start gap-3">
                    <div class="flex-1 flex flex-col gap-2">
                        <textarea class="rounded-md border-border-subtle bg-surface-1 text-sm focus:border-primary focus:ring-primary shadow-sm focus:shadow-md transition-all resize-none py-2 px-3 w-full min-h-[56px]"
                            placeholder="Введите текст варианта..." rows="2">${opt.text || ''}</textarea>
                    </div>
                    <div class="shrink-0 flex flex-col items-end gap-2">
                        ${opt.image_path ? `
                            <div class="relative group/image w-20 h-20">
                                <div class="w-full h-full rounded-lg border border-border-subtle shadow overflow-hidden bg-surface-1">
                                    <img src="${this.buildImageUrl(opt.image_path)}" alt="Option image"
                                        class="w-full h-full object-cover" />
                                </div>
                                <button class="remove-option-image absolute -top-3 right-0 bg-surface-1 border border-border-subtle shadow rounded-full p-0.5 text-text-secondary hover:text-error opacity-0 group-hover/image:opacity-100 transition"
                                    data-index="${index}" title="Удалить изображение">
                                    <span class="material-symbols-outlined text-[16px] leading-none">close</span>
                                </button>
                                <button class="upload-option-image absolute -bottom-3 left-0 w-9 h-9 rounded-full border border-border-subtle bg-surface-1 text-text-secondary hover:text-primary hover:border-primary shadow flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition"
                                    data-index="${index}" title="Заменить изображение">
                                    <span class="material-symbols-outlined text-[18px]">photo_library</span>
                                </button>
                            </div>
                        ` : `
                            <div class="relative group/image w-20 h-20">
                                <div class="w-full h-full rounded-lg border border-dashed border-border-subtle text-text-disabled flex items-center justify-center text-[10px] text-center px-2 bg-surface-1">
                                    Нет изображения
                                </div>
                                <button class="upload-option-image absolute -bottom-3 left-0 w-9 h-9 rounded-full border border-border-subtle bg-surface-1 text-text-disabled hover:text-primary hover:border-primary shadow flex items-center justify-center transition"
                                    data-index="${index}" title="Добавить изображение">
                                    <span class="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                                </button>
                            </div>
                        `}
                    </div>
                </div>
                <div class="pt-3 flex items-center gap-2 shrink-0">
                    <button class="text-text-disabled hover:text-error transition-all active:scale-95 delete-option" title="Удалить вариант">
                        <span class="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
            `;

            const txt = div.querySelector('textarea');
            txt.oninput = (e) => {
                q.options[index].text = e.target.value;
                this.markUnsavedChanges();
            };

            const letterBtn = div.querySelector('.option-letter');
            const applyLetterState = () => {
                letterBtn.classList.toggle('correct', q.options[index].is_correct);
            };
            applyLetterState();
            letterBtn.onclick = (e) => {
                e.preventDefault();
                q.options[index].is_correct = !q.options[index].is_correct;
                applyLetterState();
                this.updateAnswerTypeDisplay();
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
                    this.renderOptions();
                    this.markUnsavedChanges();
                };
            }

            div.querySelector('.delete-option').onclick = () => {
                q.options.splice(index, 1);
                this.renderOptions();
                this.markUnsavedChanges();
            };

            container.appendChild(div);
        });

        this.updateAnswerTypeDisplay();
    }

    addQuestion() {
        this.questions.push(this.createEmptyQuestion());
        this.currentQuestionIndex = this.questions.length - 1;
        if (this.task) this.renderUI();
        this.markUnsavedChanges();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    addOption() {
        const q = this.questions[this.currentQuestionIndex];
        if (!q) return;

        if (!Array.isArray(q.options)) {
            q.options = [];
        }
        q.options.push({ text: "", is_correct: false, image_path: null });
        this.renderOptions();
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

        const removeQuestionImageBtn = document.querySelector('#remove-question-image-btn');
        if (removeQuestionImageBtn) {
            removeQuestionImageBtn.onclick = (e) => {
                e.preventDefault();
                this.clearQuestionImage();
            };
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

        const clearBtn = document.querySelector('#clear-test-btn');
        if (clearBtn) clearBtn.onclick = () => this.clearTest();

        const deleteBtn = document.querySelector('#delete-test-btn');
        if (deleteBtn) deleteBtn.onclick = () => this.deleteTest();
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

        const formData = new FormData();
        formData.append('file', file);
        formData.append('module', this.task.task_data.meta.module);
        formData.append('topic', this.task.task_data.meta.topic);
        formData.append('task', this.task.metadata.id);

        try {
            await this.withLoading('Загрузка изображения...', async () => {
                const data = await this.requestJson('/api/editor/upload-image', {
                    method: 'POST',
                    body: formData
                });

                const q = this.questions[this.currentQuestionIndex];
                q.image = data.path;
                this.renderCurrentQuestion();
                this.showToast('Изображение обновлено', 'success');
                this.markUnsavedChanges();
            });
        } catch (error) {
            console.error("Error uploading image:", error);
            this.showToast(error.message || 'Ошибка загрузки изображения', 'error');
        }
    }

    clearQuestionImage() {
        const q = this.questions[this.currentQuestionIndex];
        if (!q || !q.image) return;
        q.image = null;
        this.renderCurrentQuestion();
        this.showToast('Изображение удалено', 'info');
        this.markUnsavedChanges();
    }

    async handleOptionImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (this.pendingOptionImageIndex === null) return;

        const currentQuestion = this.questions[this.currentQuestionIndex];
        if (!currentQuestion || !currentQuestion.options[this.pendingOptionImageIndex]) {
            this.pendingOptionImageIndex = null;
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('module', this.task.task_data.meta.module);
        formData.append('topic', this.task.task_data.meta.topic);
        formData.append('task', this.task.metadata.id);

        try {
            await this.withLoading('Загрузка изображения варианта...', async () => {
                const data = await this.requestJson('/api/editor/upload-image', {
                    method: 'POST',
                    body: formData
                });
                currentQuestion.options[this.pendingOptionImageIndex].image_path = data.path;
                this.renderOptions();
                this.showToast('Изображение варианта обновлено', 'success');
                this.markUnsavedChanges();
            });
        } catch (error) {
            this.showToast(error.message || 'Ошибка загрузки изображения варианта', 'error');
        } finally {
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
                if ((!opt.text || !opt.text.trim()) && !opt.image_path) {
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
        // Update task content with current questions
        this.task.task_data.content = this.buildBackendContent();
        return this.task.task_data;
    }

    /**
     * Called after task is successfully saved (BaseEditor hook)
     */
    onTaskSaved() {
        // Update snapshot and save status
        this.initialSnapshot = this.captureSnapshot();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus(false);
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
        const clearConfirmed = await this.confirmAction({
            title: 'Clear test?',
            message: 'All questions will be removed.',
            confirmText: 'Clear',
            cancelText: 'Cancel',
            variant: 'warning'
        });
        if (!clearConfirmed) {
            return;
        }
        this.questions = [this.createEmptyQuestion()];
        this.currentQuestionIndex = 0;
        this.renderUI();
        return;

        const confirmed = await this.confirmAction({
            title: 'РћС‡РёСЃС‚РёС‚СЊ С‚РµСЃС‚?',
            message: 'Р’СЃРµ РІРѕРїСЂРѕСЃС‹ Р±СѓРґСѓС‚ СѓРґР°Р»РµРЅС‹.',
            confirmText: 'РћС‡РёСЃС‚РёС‚СЊ',
            cancelText: 'РћС‚РјРµРЅР°',
            variant: 'warning'
        });
        if (!confirmed) {
            return;
        }
        if (!confirm('Очистить текущий тест? Все вопросы будут удалены.')) {
            return;
        }
        this.questions = [this.createEmptyQuestion()];
        this.currentQuestionIndex = 0;
        this.renderUI();
    }

    async deleteTest() {
        if (!this.task) return;
        const deleteConfirmed = await this.confirmAction({
            title: 'Delete task?',
            message: 'This action cannot be undone.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'error'
        });
        if (!deleteConfirmed) {
            return;
        }
        try {
            await this.withLoading('Deleting task...', async () => {
                const m = this.task.task_data.meta.module;
                const t = this.task.task_data.meta.topic;
                const id = this.task.metadata.id;

                const response = await fetch(`/api/editor/task/${encodeURIComponent(m)}/${encodeURIComponent(t)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || 'Failed to delete task');
                }
                this.showToast('Task deleted', 'success');
                window.navigateWithTransition('/ui/editor');
            });
        } catch (err) {
            this.showToast(err.message || 'Delete failed', 'error');
        }
        return;

        if (!this.task) return;
        if (!confirm('Удалить это задание? Действие необратимо.')) {
            return;
        }
        try {
            await this.withLoading('Сохранение теста...', async () => {
                const m = this.task.task_data.meta.module;
                const t = this.task.task_data.meta.topic;
                const id = this.task.metadata.id;

                const response = await fetch(`/api/editor/task/${m}/${t}/${id}`, { method: 'DELETE' });
                const data = await response.json();
                if (data.ok) {
                    this.showToast('Задание удалено', 'success');
                    window.navigateWithTransition('/ui/editor');
                }
            });
        } catch (err) {
            this.showToast(err.message || 'Ошибка удаления', 'error');
        }
    }

    showToast(message, variant = 'info') {
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
        toast.className = `pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-text-on-dark flex items-center gap-2 transition transform ${palette[variant] || palette.info}`;
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-[18px]';
        icon.textContent = icons[variant] || icons.info;
        const text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(icon);
        toast.appendChild(text);
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        this.toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 3500);
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
