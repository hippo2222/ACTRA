/**
 * ACTRA Open Answer Editor
 */

const OPEN_ANSWER_ONBOARDING_TOUR_ID = 'open-answer-authoring';

class OpenAnswerEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task and this.hasUnsavedChanges are now inherited from BaseEditor

        // Open Answer Editor specific fields
        this._legacyKeywords = [];
        this._legacySequenceMatters = false;
        this.questions = [];
        this.caseText = '';
        this.displayMode = 'simultaneous';
        this.savedKeywords = [];
        this.maxImages = 3;
        this.isRendering = false;
        this.imagePreviewOverlay = null;
        this.imagePreviewImg = null;
        this.imagePreviewCloseBtn = null;
        this.toastHideTimer = null;
        this.toastDismissTimer = null;
        this.toastDismissCallback = null;
        this.pendingDeletedImageUndo = null;
        this.openAnswerOnboardingPreview = new URLSearchParams(window.location.search)
            .get('onboarding_preview') === OPEN_ANSWER_ONBOARDING_TOUR_ID;
        this.openAnswerOnboardingFinished = false;
        this.openAnswerOnboardingDemoSnapshot = null;
        this.openAnswerOnboardingDemoActive = false;
        this.handleGlobalKeyDown = (event) => {
            if (event.key === 'Escape') {
                this.hideImagePreview();
            }
        };

        this.init();
    }

    get keywords() {
        if (this.questions && this.questions[0]) {
            return this.questions[0].keywords || [];
        }
        return this._legacyKeywords || [];
    }

    set keywords(val) {
        this._legacyKeywords = val;
        if (this.questions && this.questions[0]) {
            this.questions[0].keywords = val;
        }
    }

    get sequenceMatters() {
        if (this.questions && this.questions[0]) {
            return Boolean(this.questions[0].sequence_matters);
        }
        return Boolean(this._legacySequenceMatters);
    }

    set sequenceMatters(val) {
        this._legacySequenceMatters = Boolean(val);
        if (this.questions && this.questions[0]) {
            this.questions[0].sequence_matters = Boolean(val);
        }
    }

    async init() {
        if (this.openAnswerOnboardingPreview) {
            this.ensureOpenAnswerOnboardingPreviewTask();
            this.applyOpenAnswerOnboardingPreviewState();
        } else {
            await this.initTaskFromUrlContext();
        }
        this.setupOpenAnswerOnboardingTourBridge();
        this.setupEventListeners();
        this.setupDirtyTracking();
        this.setupBeforeUnloadWarning();
    }

    ensureOpenAnswerOnboardingPreviewTask() {
        if (!this.openAnswerOnboardingPreview) return;

        this.moduleId = this.moduleId || 'onboarding-preview-module';
        this.topicId = this.topicId || 'onboarding-preview-topic';
        this.taskId = this.taskId || 'onboarding-preview-open-answer';
        this.isNewTaskParam = true;
        this.hasPersistedTask = false;
        this.task = {
            task_data: {
                id: this.taskId,
                type: 'open_answer',
                name: 'Открытый ответ: газообмен',
                content: {},
                settings: {},
                meta: {
                    id: this.taskId,
                    module: this.moduleId,
                    topic: this.topicId,
                    name: 'Открытый ответ: газообмен',
                },
            },
            metadata: {
                id: this.taskId,
                module: this.moduleId,
                topic: this.topicId,
                name: 'Открытый ответ: газообмен',
                type: 'open_answer',
            },
        };
    }

    createOpenAnswerOnboardingContent() {
        const onboardingAlveoliImageUrl = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20160%20120%22%3E%3Crect%20width%3D%22160%22%20height%3D%22120%22%20rx%3D%2216%22%20fill%3D%22%23eef7ff%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%232f63d8%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M80%2062%20V24%22%2F%3E%3Cpath%20d%3D%22M80%2062%20C62%2052%2050%2043%2038%2031%22%2F%3E%3Cpath%20d%3D%22M80%2062%20C98%2052%20110%2043%20122%2031%22%2F%3E%3C%2Fg%3E%3Cg%20fill%3D%22%23dbeafe%22%20stroke%3D%22%230f766e%22%20stroke-width%3D%223%22%3E%3Ccircle%20cx%3D%2240%22%20cy%3D%2282%22%20r%3D%2216%22%2F%3E%3Ccircle%20cx%3D%2280%22%20cy%3D%2291%22%20r%3D%2219%22%2F%3E%3Ccircle%20cx%3D%22120%22%20cy%3D%2282%22%20r%3D%2216%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M29%2098%20C62%20110%2099%20110%20131%2098%22%20fill%3D%22none%22%20stroke%3D%22%23ef4444%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-dasharray%3D%226%207%22%2F%3E%3C%2Fsvg%3E';
        const q1 = {
            id: 'q_1',
            question: 'Как называется процесс обмена кислородом и углекислым газом в альвеолах?',
            prompt: 'Как называется процесс обмена кислородом и углекислым газом в альвеолах?',
            reference_answer: 'Этот процесс называется газообмен.',
            hint: 'Вспомните термин для обмена газами в альвеолах.',
            keywords: ['газообмен'],
            sequence_matters: false,
            levels: [1, 2, 3],
        };
        return {
            case_text: '',
            display_mode: 'simultaneous',
            question: q1.question,
            prompt: q1.prompt,
            reference_answer: q1.reference_answer,
            hint: q1.hint,
            keywords: q1.keywords,
            sequence_matters: false,
            maxLength: 420,
            questions: [q1],
            images: [{ asset_url: onboardingAlveoliImageUrl }],
        };
    }

    applyOpenAnswerOnboardingPreviewState() {
        if ((!this.openAnswerOnboardingPreview && !this.openAnswerOnboardingDemoActive) || !this.task) return;

        if (!this.task.task_data) this.task.task_data = {};
        if (!this.task.task_data.meta) this.task.task_data.meta = {};
        if (!this.task.metadata) this.task.metadata = {};
        this.task.task_data.name = 'Открытый ответ: газообмен';
        this.task.task_data.type = 'open_answer';
        this.task.task_data.meta.name = 'Открытый ответ: газообмен';
        this.task.metadata.name = 'Открытый ответ: газообмен';
        this.task.metadata.type = 'open_answer';
        this.task.task_data.content = this.createOpenAnswerOnboardingContent();
        this.initQuestionsFromContent();
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    createEmptyOpenAnswerOnboardingContent() {
        return {
            case_text: '',
            display_mode: 'simultaneous',
            question: '',
            prompt: '',
            reference_answer: '',
            hint: '',
            keywords: [],
            sequence_matters: false,
            questions: [{
                id: 'q_1',
                question: '',
                prompt: '',
                reference_answer: '',
                hint: '',
                keywords: [],
                sequence_matters: false,
                levels: [1, 2, 3],
            }],
            images: [],
        };
    }

    resetOpenAnswerOnboardingPreviewState() {
        if (!this.openAnswerOnboardingPreview || !this.task || this.openAnswerOnboardingFinished) return;
        this.openAnswerOnboardingFinished = true;
        this.task.task_data.content = this.createEmptyOpenAnswerOnboardingContent();
        this.initQuestionsFromContent();
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    cloneOpenAnswerOnboardingValue(value) {
        if (value == null) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    applyOpenAnswerOnboardingDemoState() {
        if (this.openAnswerOnboardingPreview || !this.task) return;
        if (!this.openAnswerOnboardingDemoSnapshot) {
            this.openAnswerOnboardingDemoSnapshot = {
                task: this.cloneOpenAnswerOnboardingValue(this.task),
                questions: this.cloneOpenAnswerOnboardingValue(this.questions),
                caseText: this.caseText,
                displayMode: this.displayMode,
                keywords: this.cloneOpenAnswerOnboardingValue(this.keywords),
                sequenceMatters: this.sequenceMatters,
                hasUnsavedChanges: this.hasUnsavedChanges,
            };
        }
        this.openAnswerOnboardingDemoActive = true;
        this.applyOpenAnswerOnboardingPreviewState();
    }

    restoreOpenAnswerOnboardingDemoState() {
        const snapshot = this.openAnswerOnboardingDemoSnapshot;
        this.openAnswerOnboardingDemoSnapshot = null;
        this.openAnswerOnboardingDemoActive = false;
        if (!snapshot) return;
        this.task = this.cloneOpenAnswerOnboardingValue(snapshot.task);
        this.caseText = snapshot.caseText || '';
        this.displayMode = snapshot.displayMode || 'simultaneous';
        if (Array.isArray(snapshot.questions)) {
            this.questions = this.cloneOpenAnswerOnboardingValue(snapshot.questions);
        } else {
            this.initQuestionsFromContent();
        }
        this.sequenceMatters = Boolean(snapshot.sequenceMatters);
        this.renderUI();
        this.hasUnsavedChanges = Boolean(snapshot.hasUnsavedChanges);
        this.updateSaveStatus();
    }

    setupOpenAnswerOnboardingTourBridge() {
        window.addEventListener('onboarding:before-start', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== OPEN_ANSWER_ONBOARDING_TOUR_ID || detail.preview) return;
            this.applyOpenAnswerOnboardingDemoState();
        });

        window.addEventListener('onboarding:finish', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== OPEN_ANSWER_ONBOARDING_TOUR_ID) return;
            if (!this.openAnswerOnboardingPreview) {
                this.restoreOpenAnswerOnboardingDemoState();
                return;
            }
            this.resetOpenAnswerOnboardingPreviewState();
        });
    }

    /**
     * Called after task is loaded from backend (BaseEditor hook)
     */
    onTaskLoaded() {
        const content = this.task.task_data.content || {};
        this.task.task_data.content = content;

        // Ensure images array exists
        content.images = this.normalizeContentImages(content.images);

        // Initialize multi-question state
        this.initQuestionsFromContent();

        // Render UI
        this.renderUI();
        this.updateSaveStatus();
    }

    initQuestionsFromContent() {
        const content = this.task?.task_data?.content || {};
        this.caseText = content.case_text || '';
        this.displayMode = content.display_mode === 'sequential' ? 'sequential' : 'simultaneous';

        if (Array.isArray(content.questions) && content.questions.length > 0) {
            this.questions = content.questions.map((q, idx) => {
                const storedKw = this.extractStoredKeywords(q.keywords);
                const refText = q.reference_answer || '';
                const candidateKeywords = this.extractKeywordCandidatesFromText(refText, storedKw, q.keywords || []);
                return {
                    id: q.id || `q_${idx + 1}`,
                    question: q.question || q.prompt || '',
                    reference_answer: refText,
                    hint: q.hint || '',
                    keywords: candidateKeywords,
                    sequence_matters: Boolean(q.sequence_matters ?? content.sequence_matters),
                    levels: Array.isArray(q.levels) && q.levels.length > 0 ? [...q.levels] : [1, 2, 3],
                    collapsed: false,
                };
            });
        } else {
            const storedKw = this.extractStoredKeywords(content.keywords);
            const refText = content.reference_answer || '';
            const initialKw = (this._legacyKeywords && this._legacyKeywords.length > 0)
                ? this._legacyKeywords
                : (content.keywords || []);
            const candidateKeywords = this.extractKeywordCandidatesFromText(refText, storedKw, initialKw);
            this.questions = [{
                id: 'q_1',
                question: content.question || content.prompt || '',
                reference_answer: refText,
                hint: content.hint || '',
                keywords: candidateKeywords,
                sequence_matters: Boolean(content.sequence_matters ?? content.check_sequence ?? this._legacySequenceMatters),
                levels: [1, 2, 3],
                collapsed: false,
            }];
        }

        if (this._legacyKeywords && this._legacyKeywords.length > 0 && this.questions[0]) {
            this.questions[0].keywords = this._legacyKeywords;
        }
    }

    renderUI() {
        if (!this.task) return;

        const content = this.task.task_data.content || {};

        // If questions are not initialized or content was replaced externally
        if (!this.questions || this.questions.length === 0 || (content.question && this.questions.length === 1 && this.questions[0].question !== content.question)) {
            this.initQuestionsFromContent();
        }

        // Header
        const headerTitle = document.querySelector('#editor-title');
        if (headerTitle) {
            const humanName =
                this.task.task_data?.name ||
                this.task.task_data?.title ||
                this.task.task_data?.meta?.title ||
                this.task.metadata?.title ||
                this.task.metadata?.name ||
                this.task.metadata?.id ||
                wt('open_answer_editor.task_default', 'Задание');
            headerTitle.textContent = wt('open_answer_editor.edit_task_title', 'Редактирование задания: {name}').replace('{name}', humanName);
        }

        // Case text
        const caseArea = document.querySelector('#case-textarea');
        if (caseArea) {
            caseArea.value = this.caseText || content.case_text || '';
        }

        // Display mode
        const activeRadio = document.querySelector(`input[name="display-mode"][value="${this.displayMode}"]`);
        if (activeRadio) {
            activeRadio.checked = true;
        }

        // Questions container
        const questionsContainer = document.querySelector('#questions-container');
        if (questionsContainer) {
            this.renderQuestions();
        } else {
            // Fallback for mock test DOM environments without #questions-container
            const firstQ = (this.questions && this.questions[0]) ? this.questions[0] : {
                question: content.question || content.prompt || '',
                reference_answer: content.reference_answer || '',
                hint: content.hint || '',
                keywords: content.keywords || [],
                sequence_matters: Boolean(content.sequence_matters)
            };

            const questionArea = document.querySelector('#question-textarea');
            if (questionArea) questionArea.value = firstQ.question || '';

            const referenceArea = document.querySelector('#reference-textarea');
            if (referenceArea) referenceArea.value = firstQ.reference_answer || '';

            const hintArea = document.querySelector('#hint-textarea');
            if (hintArea) hintArea.value = firstQ.hint || '';

            const sequenceToggle = document.querySelector('#sequence-order-check');
            if (sequenceToggle) sequenceToggle.checked = Boolean(firstQ.sequence_matters);

            this.savedKeywords = this.extractStoredKeywords(firstQ.keywords || content.keywords);
            const referenceText = referenceArea ? referenceArea.value : '';
            this.keywords = this.extractKeywordCandidatesFromText(referenceText, this.savedKeywords, firstQ.keywords || this.keywords);

            this.isRendering = true;
            this.renderKeywords();
            this.isRendering = false;
        }

        // Settings
        const maxLengthInput = document.querySelector('#max-length-input');
        if (maxLengthInput) {
            const resolvedMaxLength = this.resolveStoredMaxLength();
            maxLengthInput.value = resolvedMaxLength ? resolvedMaxLength.toString() : '';
        }

        const sequenceToggle = document.querySelector('#sequence-order-check');
        if (sequenceToggle && this.questions && this.questions[0]) {
            sequenceToggle.checked = Boolean(this.questions[0].sequence_matters);
        }

        this.isRendering = true;
        this.renderImages();
        this.updateDisplayModeUI();
        this.applyAutoResize();
        this.isRendering = false;
    }

    updateDisplayModeUI() {
        const mode = this.displayMode || 'simultaneous';
        const radio = document.querySelector(`input[name="display-mode"][value="${mode}"]`);
        if (radio) radio.checked = true;

        document.querySelectorAll('.display-mode-card').forEach((card) => {
            const input = card.querySelector('input[name="display-mode"]');
            const isSelected = input && input.value === mode;
            card.classList.toggle('border-primary', Boolean(isSelected));
            card.classList.toggle('ring-1', Boolean(isSelected));
            card.classList.toggle('ring-primary/30', Boolean(isSelected));
        });

        const notices = document.querySelectorAll('.sequential-step-notice');
        notices.forEach((notice) => {
            if (mode === 'sequential') {
                notice.classList.remove('hidden');
            } else {
                notice.classList.add('hidden');
            }
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    resolveStoredMaxLength() {
        if (!this.task?.task_data) return null;

        const content = this.task.task_data.content || {};
        const settings = this.task.task_data.settings || {};
        const candidates = [
            content.max_length,
            content.maxLength,
            settings.max_length,
            settings.maxLength,
        ];

        for (const candidate of candidates) {
            const parsed = Number(candidate);
            if (Number.isInteger(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return null;
    }

    readMaxLengthPreference() {
        const input = document.querySelector('#max-length-input');
        if (!input) {
            return { isSet: false, value: null, invalid: false };
        }

        const rawValue = String(input.value || '').trim();
        if (!rawValue) {
            return { isSet: false, value: null, invalid: false };
        }

        const parsed = Number(rawValue);
        if (!Number.isInteger(parsed) || parsed < 1) {
            return { isSet: true, value: null, invalid: true };
        }

        return { isSet: true, value: parsed, invalid: false };
    }

    syncLegacyMaxLength(maxLength) {
        const taskData = this.task?.task_data;
        if (!taskData) return;

        const settings = (taskData.settings && typeof taskData.settings === 'object')
            ? taskData.settings
            : (taskData.settings = {});

        if (maxLength == null) {
            delete settings.max_length;
            delete settings.maxLength;
            return;
        }

        settings.max_length = maxLength;
        delete settings.maxLength;
    }

    normalizeImageReference(raw) {
        if (!raw && raw !== 0) return null;

        if (typeof raw === 'string') {
            const value = raw.trim();
            if (!value) return null;
            if (value.startsWith('/api/assets/') || /^(https?:|data:)/i.test(value)) {
                return { path: null, asset_id: null, asset_url: value };
            }
            return { path: value, asset_id: null, asset_url: null };
        }

        if (typeof raw !== 'object') return null;

        const nested = raw.image && typeof raw.image === 'object' ? raw.image : null;
        const path = String(
            raw.path ??
            raw.image_path ??
            (typeof raw.image === 'string' ? raw.image : null) ??
            raw.src ??
            nested?.path ??
            nested?.image_path ??
            nested?.src ??
            ''
        ).trim();
        const asset_id = String(
            raw.asset_id ??
            raw.image_asset_id ??
            nested?.asset_id ??
            nested?.image_asset_id ??
            ''
        ).trim();
        const asset_url = String(
            raw.asset_url ??
            raw.image_asset_url ??
            raw.image_url ??
            raw.url ??
            nested?.asset_url ??
            nested?.image_asset_url ??
            nested?.image_url ??
            nested?.url ??
            ''
        ).trim();

        if (!path && !asset_id && !asset_url) return null;
        return {
            path: path || null,
            asset_id: asset_id || null,
            asset_url: asset_url || null,
        };
    }

    serializeImageReference(raw) {
        const normalized = this.normalizeImageReference(raw);
        if (!normalized) return null;
        if (normalized.asset_id || normalized.asset_url) {
            const payload = {};
            if (normalized.path) payload.path = normalized.path;
            if (normalized.asset_id) payload.asset_id = normalized.asset_id;
            if (normalized.asset_url) payload.asset_url = normalized.asset_url;
            return payload;
        }
        return normalized.path || null;
    }

    normalizeContentImages(rawImages) {
        if (!Array.isArray(rawImages)) return [];
        const normalized = [];
        const seen = new Set();
        rawImages.forEach((item) => {
            const serialized = this.serializeImageReference(item);
            if (!serialized) return;
            const ref = this.normalizeImageReference(serialized);
            const key = ref
                ? `${ref.asset_url || ''}::${ref.asset_id || ''}::${ref.path || ''}`
                : String(serialized);
            if (seen.has(key)) return;
            seen.add(key);
            normalized.push(serialized);
        });
        return normalized.slice(0, this.maxImages);
    }

    resolveEditorImagePreviewSrc(raw) {
        const normalized = this.normalizeImageReference(raw);
        if (!normalized) return '';
        if (normalized.asset_url) return normalized.asset_url;
        if (normalized.asset_id) {
            return `/api/editor/image?asset_id=${encodeURIComponent(normalized.asset_id)}`;
        }
        const path = normalized.path || '';
        if (!path) return '';
        if (/^(https?:|data:)/i.test(path) || path.startsWith('/api/')) return path;
        if (path.startsWith('/')) return path;
        return `/api/editor/image?path=${encodeURIComponent(path)}`;
    }

    renderQuestions() {
        const container = document.querySelector('#questions-container');
        if (!container) return;

        container.innerHTML = '';

        const totalCount = this.questions.length;
        this.questions.forEach((q, idx) => {
            const card = document.createElement('div');
            card.className = `open-answer-question-card animate-scale-in ${q.collapsed ? 'is-collapsed' : ''}`;
            card.dataset.questionIndex = String(idx);

            const isSingle = totalCount <= 1;
            const isFirst = idx === 0;
            const isLast = idx === totalCount - 1;

            const qId = isFirst ? 'question-textarea' : `question-textarea-${idx}`;
            const rId = isFirst ? 'reference-textarea' : `reference-textarea-${idx}`;
            const sId = isFirst ? 'split-keywords-btn' : `split-keywords-btn-${idx}`;
            const kId = isFirst ? 'keywords-container' : `keywords-container-${idx}`;
            const bId = isFirst ? 'selected-count-badge' : `selected-count-badge-${idx}`;
            const hId = isFirst ? 'hint-textarea' : `hint-textarea-${idx}`;

            const obTargetQBlock = isFirst ? 'data-onboarding-spotlight="frame" data-onboarding-target="open-answer-question-block"' : '';
            const obTargetQText = isFirst ? 'data-onboarding-target="open-answer-question-text"' : '';
            const obTargetRBlock = isFirst ? 'data-onboarding-spotlight="frame" data-onboarding-target="open-answer-reference-block"' : '';
            const obTargetRText = isFirst ? 'data-onboarding-target="open-answer-reference-text"' : '';
            const obTargetSplit = isFirst ? 'data-onboarding-target="open-answer-split-keywords"' : '';
            const obTargetKwHintBlock = isFirst ? 'data-onboarding-spotlight="frame" data-onboarding-target="open-answer-keywords-hint-block"' : '';
            const obTargetCount = isFirst ? 'data-onboarding-target="open-answer-selected-count"' : '';
            const obTargetKwCont = isFirst ? 'data-onboarding-target="open-answer-keywords-container"' : '';
            const obTargetHintBlock = isFirst ? 'data-onboarding-target="open-answer-hint-block"' : '';
            const obTargetHintText = isFirst ? 'data-onboarding-target="open-answer-hint-text"' : '';

            const isL1 = (q.levels || [1, 2, 3]).includes(1);
            const isL2 = (q.levels || [1, 2, 3]).includes(2);
            const isL3 = (q.levels || [1, 2, 3]).includes(3);

            const cardTitle = wt('open_answer_editor.tab_question_n', 'Вопрос {n}').replace('{n}', idx + 1);
            const snippetText = q.collapsed ? (q.question || '').slice(0, 50) : '';

            card.innerHTML = `
                <div class="question-card-header">
                    <div class="question-card-header-main">
                        <span class="question-badge">${cardTitle}</span>
                        <div class="question-levels-badges">
                            <span class="question-level-pill ${isL1 ? 'is-active' : ''}" title="${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 1)}">L1</span>
                            <span class="question-level-pill ${isL2 ? 'is-active' : ''}" title="${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 2)}">L2</span>
                            <span class="question-level-pill ${isL3 ? 'is-active' : ''}" title="${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 3)}">L3</span>
                        </div>
                        <span class="question-snippet">${this.escapeHtml(snippetText)}</span>
                    </div>
                    <div class="question-card-actions">
                        <button type="button" class="question-card-btn move-up-btn" title="${wt('open_answer_editor.move_up', 'Переместить вопрос выше')}" aria-label="${wt('open_answer_editor.move_up', 'Переместить вопрос выше')}" ${isFirst ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-[18px]">arrow_upward</span>
                        </button>
                        <button type="button" class="question-card-btn move-down-btn" title="${wt('open_answer_editor.move_down', 'Переместить вопрос ниже')}" aria-label="${wt('open_answer_editor.move_down', 'Переместить вопрос ниже')}" ${isLast ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-[18px]">arrow_downward</span>
                        </button>
                        <button type="button" class="question-card-btn collapse-btn" title="${q.collapsed ? wt('open_answer_editor.expand', 'Развернуть вопрос') : wt('open_answer_editor.collapse', 'Свернуть вопрос')}" aria-label="${q.collapsed ? wt('open_answer_editor.expand', 'Развернуть вопрос') : wt('open_answer_editor.collapse', 'Свернуть вопрос')}" aria-expanded="${!q.collapsed}">
                            <span class="material-symbols-outlined text-[18px]">${q.collapsed ? 'expand_more' : 'expand_less'}</span>
                        </button>
                        <button type="button" class="question-card-btn delete-btn" title="${wt('open_answer_editor.delete_question_title', 'Удалить вопрос')}" aria-label="${wt('open_answer_editor.delete_question_title', 'Удалить вопрос')}" ${isSingle ? 'disabled' : ''}>
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    </div>
                </div>
                <div class="question-card-body">
                    <div class="sequential-step-notice ${this.displayMode === 'sequential' ? '' : 'hidden'}">
                        <span class="material-symbols-outlined notice-icon">info</span>
                        <span>${wt('open_answer_editor.sequential_step_notice', 'В последовательном режиме эталонный ответ и ключевые слова показываются студенту сразу после ответа на этот шаг. Убедитесь, что эталон не содержит прямых ответов на следующие шаги.')}</span>
                    </div>

                    <!-- Question Text -->
                    <div class="flex flex-col gap-2" ${obTargetQBlock}>
                        <label for="${qId}" class="text-sm font-semibold text-text-main flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] text-text-disabled">help</span>
                            <span>${wt('open_answer_editor.question_label', 'Вопрос')}</span>
                        </label>
                        <div class="bg-surface-2 rounded-xl shadow-sm border border-border-subtle overflow-hidden focus-within:border-primary transition-all">
                            <textarea id="${qId}" data-auto-resize="true" ${obTargetQText}
                                class="w-full border-0 p-4 text-sm text-text-main placeholder:text-text-disabled focus:ring-0 resize-none min-h-[60px] leading-relaxed bg-transparent"
                                placeholder="${wt('open_answer_editor.question_placeholder', 'Введите формулировку вопроса или описание кейса...')}"></textarea>
                        </div>
                    </div>

                    <!-- Reference Answer -->
                    <div class="flex flex-col gap-2" ${obTargetRBlock}>
                        <div class="flex items-center justify-between">
                            <label for="${rId}" class="text-sm font-semibold text-text-main flex items-center gap-2">
                                <span class="material-symbols-outlined text-[18px] text-text-disabled">check_circle</span>
                                <span>${wt('open_answer_editor.reference_label', 'Эталонный ответ')}</span>
                            </label>
                        </div>
                        <div class="bg-surface-2 rounded-xl shadow-sm border border-border-subtle overflow-hidden focus-within:border-primary transition-all">
                            <textarea id="${rId}" data-auto-resize="true" ${obTargetRText}
                                class="w-full border-0 p-4 text-sm text-text-main placeholder:text-text-disabled focus:ring-0 resize-none min-h-[72px] leading-relaxed bg-transparent"
                                placeholder="${wt('open_answer_editor.reference_placeholder', 'Введите текст правильного ответа...')}"></textarea>
                            <div class="border-t border-border-subtle bg-surface-2 p-3 flex items-center justify-between">
                                <span class="text-xs text-text-muted italic">${wt('open_answer_editor.reference_hint', 'Выберите слова или фразы, обязательные для правильного ответа')}</span>
                                <button id="${sId}" type="button" ${obTargetSplit}
                                    class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-primary bg-primary-lighter hover:bg-primary-light rounded-md border border-primary-light transition-colors">
                                    <span class="material-symbols-outlined text-[16px]">cut</span>
                                    <span>${wt('open_answer_editor.split_keywords_btn', 'Разбить на ключевые слова')}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Keywords & Hint -->
                    <div class="flex flex-col gap-3" ${obTargetKwHintBlock}>
                        <div class="flex items-center justify-between">
                            <h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider">${wt('open_answer_editor.keywords_title', 'Ключевые слова')}</h3>
                            <span id="${bId}" ${obTargetCount}
                                class="text-xs font-medium text-text-secondary bg-surface-2 px-2 py-0.5 rounded-full">${wt('open_answer_editor.selected_count', 'Выбрано: 0')}</span>
                        </div>
                        <div id="${kId}" ${obTargetKwCont}
                            class="flex flex-wrap gap-2 p-4 bg-surface-1 rounded-xl border border-dashed border-border-subtle min-h-[80px]">
                        </div>
                        <div class="flex flex-col gap-2" ${obTargetHintBlock}>
                            <label for="${hId}" class="text-sm font-semibold text-text-main flex items-center gap-2">
                                <span class="material-symbols-outlined text-[18px] text-text-disabled">chat_bubble</span>
                                <span>${wt('open_answer_editor.hint_label', 'Подсказка (необязательно)')}</span>
                            </label>
                            <div class="bg-surface-2 rounded-xl shadow-sm border border-border-subtle overflow-hidden focus-within:border-primary transition-all">
                                <textarea id="${hId}" data-auto-resize="true" ${obTargetHintText}
                                    class="w-full border-0 p-4 text-sm text-text-main placeholder:text-text-disabled focus:ring-0 resize-none min-h-[48px] leading-relaxed bg-transparent"
                                    placeholder="${wt('open_answer_editor.hint_placeholder', 'Добавьте подсказку, которую увидит пользователь при необходимости...')}"></textarea>
                            </div>
                        </div>
                    </div>

                    <!-- Difficulty Levels Selection -->
                    <div class="question-levels-config">
                        <div class="question-levels-header">
                            <span class="question-levels-title">${wt('open_answer_editor.difficulty_levels_title', 'Появление по уровням сложности')}</span>
                        </div>
                        <p class="text-[11px] text-text-muted leading-tight">${wt('open_answer_editor.difficulty_levels_hint', 'Отметьте итерации / уровни сложности комплекса, на которых этот вопрос должен появляться. По умолчанию новые вопросы добавляются кумулятивно.')}</p>
                        <div class="question-levels-options">
                            <label class="level-checkbox-pill">
                                <input type="checkbox" class="level-check" value="1" ${isL1 ? 'checked' : ''} />
                                <span>${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 1)}</span>
                            </label>
                            <label class="level-checkbox-pill">
                                <input type="checkbox" class="level-check" value="2" ${isL2 ? 'checked' : ''} />
                                <span>${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 2)}</span>
                            </label>
                            <label class="level-checkbox-pill">
                                <input type="checkbox" class="level-check" value="3" ${isL3 ? 'checked' : ''} />
                                <span>${wt('open_answer_editor.level_label', 'Уровень {n}').replace('{n}', 3)}</span>
                            </label>
                        </div>
                    </div>
                </div>
            `;

            container.appendChild(card);

            // Populate values and bind listeners
            const qArea = card.querySelector(`#${qId}`);
            if (qArea) {
                qArea.value = q.question || '';
                qArea.addEventListener('input', (e) => {
                    q.question = e.target.value;
                    if (card.classList.contains('is-collapsed')) {
                        const snippet = card.querySelector('.question-snippet');
                        if (snippet) snippet.textContent = q.question.slice(0, 50);
                    }
                    this.markUnsaved();
                });
            }

            const rArea = card.querySelector(`#${rId}`);
            if (rArea) {
                rArea.value = q.reference_answer || '';
                rArea.addEventListener('input', (e) => {
                    q.reference_answer = e.target.value;
                    this.markUnsaved();
                });
            }

            const hArea = card.querySelector(`#${hId}`);
            if (hArea) {
                hArea.value = q.hint || '';
                hArea.addEventListener('input', (e) => {
                    q.hint = e.target.value;
                    this.markUnsaved();
                });
            }

            const splitBtn = card.querySelector(`#${sId}`);
            if (splitBtn) {
                splitBtn.onclick = () => this.splitKeywords(idx);
            }

            const upBtn = card.querySelector('.move-up-btn');
            if (upBtn) upBtn.onclick = () => this.moveQuestion(idx, idx - 1);

            const downBtn = card.querySelector('.move-down-btn');
            if (downBtn) downBtn.onclick = () => this.moveQuestion(idx, idx + 1);

            const collapseBtn = card.querySelector('.collapse-btn');
            if (collapseBtn) collapseBtn.onclick = () => this.toggleCollapse(idx);

            const deleteBtn = card.querySelector('.delete-btn');
            if (deleteBtn) deleteBtn.onclick = () => this.deleteQuestion(idx);

            card.querySelectorAll('.level-check').forEach((cb) => {
                cb.addEventListener('change', () => {
                    const checks = Array.from(card.querySelectorAll('.level-check:checked')).map(c => Number(c.value));
                    q.levels = checks.length > 0 ? checks : [];
                    const badges = card.querySelectorAll('.question-levels-badges .question-level-pill');
                    if (badges[0]) badges[0].classList.toggle('is-active', q.levels.includes(1));
                    if (badges[1]) badges[1].classList.toggle('is-active', q.levels.includes(2));
                    if (badges[2]) badges[2].classList.toggle('is-active', q.levels.includes(3));
                    this.markUnsaved();
                });
            });

            this.renderKeywordsForQuestion(idx);
        });

        this.applyAutoResize();
    }

    renderKeywordsForQuestion(idx = 0) {
        const isFirst = idx === 0;
        const container = isFirst
            ? document.querySelector('#keywords-container')
            : document.querySelector(`#keywords-container-${idx}`);
        const badge = isFirst
            ? document.querySelector('#selected-count-badge')
            : document.querySelector(`#selected-count-badge-${idx}`);
        if (!container) return;

        container.innerHTML = '';
        let selectedCount = 0;

        const q = (this.questions && this.questions[idx]) ? this.questions[idx] : null;
        let kwList = q ? (q.keywords || []) : (this._legacyKeywords || []);

        kwList = kwList
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter(Boolean);

        if (q) {
            q.keywords = kwList;
        }
        if (isFirst) {
            this._legacyKeywords = kwList;
        }

        kwList.forEach((kw, index) => {
            const text = kw.text;
            const isRequired = Boolean(kw.required);
            if (isRequired) selectedCount++;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `keyword-tag pill pill-sm animate-pop-in hover:scale-105 ${isRequired ? 'active pill-info shadow-sm' : 'pill-neutral'}`;
            btn.textContent = text;

            btn.onclick = () => {
                kwList[index].required = !kwList[index].required;
                this.renderKeywordsForQuestion(idx);
                this.markUnsaved();
            };

            container.appendChild(btn);
        });

        if (!kwList.length) {
            const placeholder = document.createElement('p');
            placeholder.className = 'open-answer-keywords-placeholder text-sm text-text-muted italic';
            placeholder.textContent = wt('open_answer_editor.keywords_placeholder', 'Добавьте ключевые слова или используйте кнопку «Разбить на ключевые слова».');
            container.appendChild(placeholder);
        }

        if (badge) {
            badge.textContent = wt('open_answer_editor.selected_count', 'Выбрано: {n}').replace('{n}', selectedCount);
        }
    }

    renderKeywords() {
        this.renderKeywordsForQuestion(0);
    }

    splitKeywords(idx = 0) {
        if (typeof idx !== 'number') idx = 0;
        const isFirst = idx === 0;
        const referenceArea = isFirst
            ? document.querySelector('#reference-textarea')
            : document.querySelector(`#reference-textarea-${idx}`);
        if (!referenceArea) return;

        const text = referenceArea.value || '';
        if (!text.trim()) {
            this.showToast(wt('open_answer_editor.err_fill_reference', 'Сначала заполните эталонный ответ, чтобы выделить ключевые слова.'), 'warning');
            referenceArea.focus();
            return;
        }

        const q = (this.questions && this.questions[idx]) ? this.questions[idx] : null;
        const currentKw = q ? (q.keywords || []) : (this._legacyKeywords || []);

        const requiredLookup = new Set(
            currentKw.filter((kw) => kw?.required).map((kw) => kw.normalized)
        );
        const generated = this.buildKeywordsFromText(text).map((kw) => ({
            ...kw,
            required: requiredLookup.has(kw.normalized),
        }));

        if (!generated.length) {
            this.showToast(wt('open_answer_editor.err_split_keywords', 'Не удалось выделить ключевые слова. Проверьте эталонный ответ и попробуйте снова.'), 'warning');
            return;
        }

        if (q) {
            q.keywords = generated;
        }
        if (isFirst) {
            this._legacyKeywords = generated;
        }

        this.renderKeywordsForQuestion(idx);
        this.markUnsaved();
    }

    addQuestion() {
        this.syncFromDOM();
        const nextIdx = this.questions.length + 1;
        this.questions.push({
            id: `q_${nextIdx}`,
            question: '',
            reference_answer: '',
            hint: '',
            keywords: [],
            sequence_matters: this.questions[0] ? Boolean(this.questions[0].sequence_matters) : false,
            levels: [1, 2, 3],
            collapsed: false,
        });
        this.renderQuestions();
        this.markUnsaved();
        this.showToast(wt('open_answer_editor.question_added', 'Вопрос добавлен.'), 'info');

        const targetIdx = this.questions.length - 1;
        setTimeout(() => {
            const area = document.querySelector(`#question-textarea-${targetIdx}`);
            if (area) {
                area.focus();
                if (typeof area.scrollIntoView === 'function') {
                    area.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }, 50);
    }

    deleteQuestion(idx) {
        if (this.questions.length <= 1) {
            this.showToast(wt('open_answer_editor.err_min_one_question', 'Задание должно содержать хотя бы один вопрос.'), 'warning');
            return;
        }
        this.syncFromDOM();
        const [removed] = this.questions.splice(idx, 1);
        this.pendingDeletedQuestionUndo = { index: idx, question: removed };
        this.renderQuestions();
        this.markUnsaved();
        this.showToast(wt('open_answer_editor.question_deleted', 'Вопрос удален.'), 'info', 5000, {
            actionLabel: wt('open_answer_editor.undo', 'Отменить'),
            closeable: true,
            onAction: () => this.restoreDeletedQuestion(),
        });
    }

    restoreDeletedQuestion() {
        const pending = this.pendingDeletedQuestionUndo;
        if (!pending) return;
        this.syncFromDOM();
        const nextIndex = Math.max(0, Math.min(pending.index, this.questions.length));
        this.questions.splice(nextIndex, 0, pending.question);
        this.pendingDeletedQuestionUndo = null;
        this.renderQuestions();
        this.markUnsaved();
        this.showToast(wt('open_answer_editor.question_restored', 'Вопрос восстановлен.'), 'success');
    }

    moveQuestion(fromIdx, toIdx) {
        if (toIdx < 0 || toIdx >= this.questions.length || fromIdx === toIdx) return;
        this.syncFromDOM();
        const [moved] = this.questions.splice(fromIdx, 1);
        this.questions.splice(toIdx, 0, moved);
        this.renderQuestions();
        this.markUnsaved();
        this.expandAndFocusQuestion(toIdx, 'question');
    }

    toggleCollapse(idx) {
        if (!this.questions[idx]) return;
        this.syncFromDOM();
        this.questions[idx].collapsed = !this.questions[idx].collapsed;
        const card = document.querySelector(`.open-answer-question-card[data-question-index="${idx}"]`);
        if (card) {
            const isCollapsed = this.questions[idx].collapsed;
            card.classList.toggle('is-collapsed', isCollapsed);
            const collapseBtn = card.querySelector('.collapse-btn');
            if (collapseBtn) {
                collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
                collapseBtn.title = isCollapsed
                    ? wt('open_answer_editor.expand', 'Развернуть вопрос')
                    : wt('open_answer_editor.collapse', 'Свернуть вопрос');
                const icon = collapseBtn.querySelector('.material-symbols-outlined');
                if (icon) icon.textContent = isCollapsed ? 'expand_more' : 'expand_less';
            }
            const snippet = card.querySelector('.question-snippet');
            if (snippet) {
                snippet.textContent = isCollapsed ? (this.questions[idx].question || '').slice(0, 50) : '';
            }
        }
    }

    expandAndFocusQuestion(idx, field = 'question') {
        if (!this.questions[idx]) return;
        if (this.questions[idx].collapsed) {
            this.questions[idx].collapsed = false;
            const card = document.querySelector(`.open-answer-question-card[data-question-index="${idx}"]`);
            if (card) {
                card.classList.remove('is-collapsed');
                const collapseBtn = card.querySelector('.collapse-btn');
                if (collapseBtn) {
                    collapseBtn.setAttribute('aria-expanded', 'true');
                    collapseBtn.title = wt('open_answer_editor.collapse', 'Свернуть вопрос');
                    const icon = collapseBtn.querySelector('.material-symbols-outlined');
                    if (icon) icon.textContent = 'expand_less';
                }
            }
        }
        const targetId = idx === 0 ? `#${field}-textarea` : `#${field}-textarea-${idx}`;
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
            targetEl.focus();
            if (typeof targetEl.scrollIntoView === 'function') {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    renderImages() {
        const container = document.querySelector('#images-container');
        if (!container || !this.task) return;

        const content = this.task.task_data.content || {};
        let images = this.normalizeContentImages(content.images);
        if (images.length > this.maxImages) {
            images = images.slice(0, this.maxImages);
            content.images = images;
        }

        container.querySelectorAll('.open-answer-image-card, .images-empty-state').forEach((el) => el.remove());

        const addBtn = document.querySelector('#add-image-btn');
        const referenceNode = addBtn || container.lastElementChild;

        images.forEach((imageRef, index) => {
            const fullPath = this.resolveEditorImagePreviewSrc(imageRef);
            if (!fullPath) return;
            const div = document.createElement('div');
            div.className = 'open-answer-image-card card-elevated group relative aspect-square overflow-hidden animate-scale-in hover:translate-y-[-2px]';

            div.innerHTML = `
                <div class="absolute inset-0 flex items-center justify-center bg-bg-hover text-text-disabled">
                    <span class="material-symbols-outlined text-[32px]">image</span>
                </div>
                <img alt="Reference Image" class="absolute inset-0 w-full h-full object-cover" src="${fullPath}" />
                <div class="absolute inset-0 bg-scrim opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button class="icon-button-muted view-btn shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                    </button>
                    <button class="icon-button-muted delete-btn border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            `;

            const deleteBtn = div.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.onclick = () => this.deleteImageAtIndex(index);
            }

            const viewBtn = div.querySelector('.view-btn');
            if (viewBtn) {
                viewBtn.onclick = () => this.showImagePreview(fullPath);
            }

            container.insertBefore(div, referenceNode);
        });

        if (!images.length) {
            const emptyState = document.createElement('div');
            emptyState.className = 'images-empty-state empty-state-card empty-state-card--compact col-span-4';
            emptyState.textContent = wt('open_answer_editor.no_images', 'Изображения не добавлены');
            emptyState.innerHTML = `
                <span class="empty-state-card__icon">
                    <span class="material-symbols-outlined text-[22px]">imagesmode</span>
                </span>
                <h4 class="empty-state-card__title">${wt('open_answer_editor.no_images', 'Изображения не добавлены')}</h4>
                <p class="empty-state-card__copy">${wt('open_answer_editor.add_images_hint', 'Добавьте до {n} ссылок или изображений для задачи.').replace('{n}', this.maxImages)}</p>
            `;
            container.insertBefore(emptyState, referenceNode);
        }

        this.updateAddImageButtonState(images.length);
    }

    setupEventListeners() {
        const editorTitle = document.querySelector('#editor-title');
        if (editorTitle) {
            this.setupHeaderRenameTrigger(editorTitle, {
                onSuccess: () => this.renderUI()
            });
        }

        // Back
        const backBtn = document.querySelector('#back-to-dashboard-btn');
        if (backBtn) {
            backBtn.onclick = () => this.goBack();
        }

        // Case text
        const caseArea = document.querySelector('#case-textarea');
        if (caseArea) {
            caseArea.oninput = () => {
                this.caseText = caseArea.value;
                this.markUnsaved();
            };
        }

        // Add question button
        const addQBtn = document.querySelector('#add-question-btn');
        if (addQBtn) {
            addQBtn.onclick = () => this.addQuestion();
        }

        // Display mode radios
        document.querySelectorAll('input[name="display-mode"]').forEach((radio) => {
            radio.onchange = (e) => {
                if (e.target.checked) {
                    this.displayMode = e.target.value;
                    this.updateDisplayModeUI();
                    this.markUnsaved();
                }
            };
        });

        // Split button (fallback)
        const splitBtn = document.querySelector('#split-keywords-btn');
        if (splitBtn) splitBtn.onclick = () => this.splitKeywords(0);

        // Save button
        const saveBtn = document.querySelector('#save-task-btn');
        if (saveBtn) saveBtn.onclick = () => this.saveTask();

        // Image Upload
        const addBtn = document.querySelector('#add-image-btn');
        const fileInput = document.querySelector('#image-upload-input');
        if (addBtn && fileInput) {
            addBtn.onclick = () => fileInput.click();
            fileInput.onchange = (e) => this.handleImageUpload(e);
        }

        const sequenceToggle = document.querySelector('#sequence-order-check');
        if (sequenceToggle) {
            sequenceToggle.onchange = (event) => {
                this.sequenceMatters = event.target.checked;
                if (this.questions && this.questions[0]) {
                    this.questions[0].sequence_matters = event.target.checked;
                }
                this.markUnsaved();
            };
        }

        this.setupImagePreviewControls();
        this.applyAutoResize();
    }

    async handleImageUpload(event) {
        if (!this.task) return;
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        const content = this.task.task_data.content;
        content.images = this.normalizeContentImages(content.images);

        const remainingSlots = this.maxImages - content.images.length;
        if (remainingSlots <= 0) {
            this.showToast(wt('open_answer_editor.err_max_images', 'Можно загрузить не более {n} изображений.').replace('{n}', this.maxImages), 'warning');
            event.target.value = '';
            return;
        }

        const filesToUpload = files.slice(0, remainingSlots);
        if (filesToUpload.length < files.length) {
            this.showToast(wt('open_answer_editor.warn_max_files', 'Загружено максимальное количество файлов ({n}).').replace('{n}', this.maxImages), 'warning');
        }

        for (let file of filesToUpload) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('module', this.task.task_data.meta.module);
            formData.append('topic', this.task.task_data.meta.topic);
            formData.append('task', this.task.metadata.id);

            try {
                const response = await fetch('/api/editor/upload-image', {
                    method: 'POST',
                    body: formData
                });

                if (response.status === 413) {
                    this.showToast(wt("editor_base.error_request_too_large", "Размер файла слишком велик. Пожалуйста, выберите файл меньшего размера."), "error");
                    continue;
                }
                if (response.ok === false) {
                    this.showToast(wt('open_answer_editor.err_upload', 'Ошибка загрузки: {err}').replace('{err}', response.statusText || 'Unknown error'), 'error');
                    continue;
                }

                const data = await response.json();
                if (response.ok !== false && data.ok && (data.path || data.asset_id || data.asset_url)) {
                    if (!this.task.task_data.content.images) this.task.task_data.content.images = [];
                    const nextImageRef = this.serializeImageReference({
                        path: data.path,
                        asset_id: data.asset_id,
                        asset_url: data.asset_url,
                    });
                    if (!nextImageRef) {
                        this.showToast(wt('open_answer_editor.err_img_url', 'Не удалось подготовить ссылку на изображение.'), 'error');
                        continue;
                    }
                    this.task.task_data.content.images.push(nextImageRef);
                    this.task.task_data.content.images = this.normalizeContentImages(this.task.task_data.content.images);
                    this.markUnsaved();
                } else {
                    this.showToast(wt('open_answer_editor.err_upload', 'Ошибка загрузки: {err}').replace('{err}', data.error || 'upload_failed'), 'error');
                }
            } catch (error) {
                console.error("Ошибка загрузки изображения:", error);
                this.showToast(wt('open_answer_editor.err_upload_network', 'Ошибка загрузки изображения. Проверьте соединение и попробуйте снова.'), 'error');
            }
        }
        this.renderImages();
        event.target.value = '';
    }

    deleteImageAtIndex(index) {
        if (!this.task?.task_data?.content || !Array.isArray(this.task.task_data.content.images)) {
            return false;
        }
        if (index < 0 || index >= this.task.task_data.content.images.length) {
            return false;
        }

        const [removedImage] = this.task.task_data.content.images.splice(index, 1);
        if (!removedImage) {
            return false;
        }

        this.pendingDeletedImageUndo = { index, path: removedImage };
        this.renderImages();
        this.markUnsaved();
        this.showToast(wt('open_answer_editor.img_deleted', 'Изображение удалено.'), 'info', 5000, {
            actionLabel: wt('open_answer_editor.undo', 'Отменить'),
            closeable: true,
            onAction: () => this.restoreDeletedImage(),
        });
        return true;
    }

    restoreDeletedImage() {
        const pending = this.pendingDeletedImageUndo;
        if (!pending || !this.task?.task_data?.content) {
            return false;
        }
        const images = Array.isArray(this.task.task_data.content.images)
            ? this.task.task_data.content.images
            : (this.task.task_data.content.images = []);
        const nextIndex = Math.max(0, Math.min(pending.index, images.length));
        images.splice(nextIndex, 0, pending.path);
        this.pendingDeletedImageUndo = null;
        this.renderImages();
        this.markUnsaved();
        this.showToast(wt('open_answer_editor.img_restored', 'Изображение восстановлено.'), 'success');
        return true;
    }

    syncFromDOM() {
        const caseArea = document.querySelector('#case-textarea');
        if (caseArea) {
            this.caseText = caseArea.value;
        }

        const checkedRadio = document.querySelector('input[name="display-mode"]:checked');
        if (checkedRadio) {
            this.displayMode = checkedRadio.value;
        }

        if (!Array.isArray(this.questions) || this.questions.length === 0) {
            this.initQuestionsFromContent();
        }

        const container = document.querySelector('#questions-container');
        if (container) {
            this.questions.forEach((q, idx) => {
                const qArea = idx === 0 ? document.querySelector('#question-textarea') : document.querySelector(`#question-textarea-${idx}`);
                if (qArea) q.question = qArea.value;

                const rArea = idx === 0 ? document.querySelector('#reference-textarea') : document.querySelector(`#reference-textarea-${idx}`);
                if (rArea) q.reference_answer = rArea.value;

                const hArea = idx === 0 ? document.querySelector('#hint-textarea') : document.querySelector(`#hint-textarea-${idx}`);
                if (hArea) q.hint = hArea.value;

                const card = document.querySelector(`.open-answer-question-card[data-question-index="${idx}"]`);
                if (card) {
                    const checks = Array.from(card.querySelectorAll('.level-check:checked')).map((c) => Number(c.value));
                    q.levels = checks.length > 0 ? checks : [];
                }
            });
        } else {
            // Fallback for test DOM without #questions-container
            const qArea = document.querySelector('#question-textarea');
            const rArea = document.querySelector('#reference-textarea');
            const hArea = document.querySelector('#hint-textarea');
            if (this.questions && this.questions[0]) {
                if (qArea) this.questions[0].question = qArea.value;
                if (rArea) this.questions[0].reference_answer = rArea.value;
                if (hArea) this.questions[0].hint = hArea.value;
            }
        }

        const sequenceToggle = document.querySelector('#sequence-order-check');
        if (sequenceToggle) {
            this.sequenceMatters = sequenceToggle.checked;
            if (this.questions && this.questions[0]) {
                this.questions[0].sequence_matters = sequenceToggle.checked;
            }
        }
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        this.syncFromDOM();

        const maxLengthInput = document.querySelector('#max-length-input');
        const maxLengthPreference = this.readMaxLengthPreference();
        if (maxLengthPreference.invalid) {
            if (maxLengthInput) maxLengthInput.focus();
            return wt('open_answer_editor.err_max_length', 'Ошибка: максимальная длина ответа должна быть целым числом не меньше 1 или пустым полем.');
        }

        if (!this.questions || this.questions.length === 0) {
            return wt('open_answer_editor.err_min_one_question', 'Задание должно содержать хотя бы один вопрос.');
        }

        for (let idx = 0; idx < this.questions.length; idx++) {
            const q = this.questions[idx];
            const isSingle = this.questions.length === 1;
            const prefix = isSingle
                ? ''
                : wt('open_answer_editor.question_n_prefix', 'Вопрос #{n}: ').replace('{n}', idx + 1);

            const prompt = (q.question || '').trim();
            if (!prompt) {
                this.expandAndFocusQuestion(idx, 'question');
                return prefix + wt('open_answer_editor.err_empty_question', 'Ошибка: поле вопроса не должно быть пустым.');
            }

            const refAnswer = (q.reference_answer || '').trim();
            if (!refAnswer) {
                this.expandAndFocusQuestion(idx, 'reference');
                return prefix + wt('open_answer_editor.err_empty_reference', 'Ошибка: эталонный ответ не должен быть пустым.');
            }

            const normalizedKeywords = (q.keywords || [])
                .map((kw) => this.normalizeKeywordItem(kw))
                .filter((kw) => kw && kw.required);

            if (!normalizedKeywords.length) {
                this.expandAndFocusQuestion(idx, 'reference');
                return prefix + wt('open_answer_editor.err_no_keywords', 'Ошибка: добавьте хотя бы одно ключевое слово для проверки.');
            }

            const keywordsTexts = normalizedKeywords.map((kw) => kw.text).filter(Boolean);
            if (!keywordsTexts.length) {
                this.expandAndFocusQuestion(idx, 'reference');
                return prefix + wt('open_answer_editor.err_select_keyword', 'Ошибка: выберите хотя бы одно ключевое слово.');
            }

            if (!Array.isArray(q.levels) || q.levels.length === 0) {
                this.expandAndFocusQuestion(idx, 'question');
                return wt('open_answer_editor.err_no_level_selected', 'Вопрос #{n}: выберите хотя бы один уровень сложности для появления.').replace('{n}', idx + 1);
            }
        }

        return null;
    }

    /**
     * Build task data for saving to backend (BaseEditor abstract method)
     * @returns {Object} Task data object
     */
    buildTaskData() {
        this.syncFromDOM();

        const maxLengthPreference = this.readMaxLengthPreference();
        const maxLength = maxLengthPreference.isSet && !maxLengthPreference.invalid
            ? maxLengthPreference.value
            : null;

        const content = this.task.task_data.content || (this.task.task_data.content = {});

        const questionsPayload = (this.questions && this.questions.length > 0 ? this.questions : [
            {
                id: 'q_1',
                question: '',
                reference_answer: '',
                hint: '',
                keywords: [],
                sequence_matters: this.sequenceMatters,
                levels: [1, 2, 3],
            }
        ]).map((q, idx) => {
            const normalizedKeywords = (q.keywords || [])
                .map((kw) => this.normalizeKeywordItem(kw))
                .filter((kw) => kw && kw.required)
                .map((kw) => kw.text)
                .filter(Boolean);

            const item = {
                id: q.id || `q_${idx + 1}`,
                question: (q.question || '').trim(),
                prompt: (q.question || '').trim(),
                reference_answer: (q.reference_answer || '').trim(),
                keywords: normalizedKeywords,
                sequence_matters: Boolean(q.sequence_matters ?? this.sequenceMatters),
                levels: Array.isArray(q.levels) && q.levels.length > 0 ? [...q.levels] : [1, 2, 3],
            };

            if (q.hint && q.hint.trim()) {
                item.hint = q.hint.trim();
            }

            return item;
        });

        const firstQ = questionsPayload[0];

        // Canonical fields on root content for backward compatibility
        content.question = firstQ.question;
        content.prompt = firstQ.prompt;
        content.reference_answer = firstQ.reference_answer;
        if (firstQ.hint) {
            content.hint = firstQ.hint;
        } else {
            delete content.hint;
        }
        content.keywords = firstQ.keywords;
        content.sequence_matters = Boolean(firstQ.sequence_matters);

        // Multi-question fields
        content.case_text = (this.caseText || '').trim();
        content.display_mode = this.displayMode === 'sequential' ? 'sequential' : 'simultaneous';
        content.questions = questionsPayload;

        if (maxLength != null) {
            content.max_length = maxLength;
        } else {
            delete content.max_length;
            delete content.maxLength;
        }
        delete content.min_keywords;
        delete content.require_all_keywords;
        content.images = this.normalizeContentImages(content.images);
        this.syncLegacyMaxLength(maxLength);

        return this.task.task_data;
    }

    onTaskSaved() {
        this.markSaved();
    }

    // ===== UNDO/REDO & AUTOSAVE SUPPORT =====

    /**
     * Capture current editor state for undo/redo and autosave
     * @returns {Object} State snapshot
     */
    captureState() {
        const taskData = this.buildTaskData();
        return {
            content: JSON.parse(JSON.stringify(taskData.content))
        };
    }

    /**
     * Restore editor state from snapshot
     * @param {Object} state - State to restore
     */
    restoreState(state) {
        if (!state || !state.content) return;

        // Restore content
        this.task.task_data.content = JSON.parse(JSON.stringify(state.content));

        // Restore local state properties that depend on content
        this.initQuestionsFromContent();

        // Re-render
        this.renderUI();
        this.markUnsaved();
    }

    normalizeKeywordText(text) {
        if (!text) return '';
        return text
            .toString()
            .toLowerCase()
            .replace(/[^a-zа-яё0-9\s-]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    normalizeKeywordItem(raw) {
        if (!raw) return null;
        if (typeof raw === 'string') {
            const normalized = this.normalizeKeywordText(raw);
            if (!normalized) return null;
            return {
                text: raw.trim(),
                normalized,
                required: true
            };
        }

        const text = typeof raw.text === 'string' ? raw.text.trim() : '';
        const normalized = this.normalizeKeywordText(text);
        if (!text || !normalized) return null;
        return {
            text,
            normalized,
            required: Boolean(raw.required)
        };
    }

    extractStoredKeywords(rawKeywords) {
        const set = new Set();
        if (!Array.isArray(rawKeywords)) return set;
        rawKeywords.forEach((kw) => {
            const normalized = this.normalizeKeywordText(typeof kw === 'string' ? kw : kw?.text);
            if (normalized) {
                set.add(normalized);
            }
        });
        return set;
    }

    buildKeywordsFromText(text) {
        if (!text) return [];
        const regex = /[A-Za-zА-Яа-яЁё0-9-]+/g;
        const seen = new Set();
        const result = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            const rawWord = match[0];
            const normalized = this.normalizeKeywordText(rawWord);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push({
                text: rawWord.trim(),
                normalized,
                required: false
            });
        }

        return result;
    }

    extractKeywordCandidatesFromText(referenceText, savedKeywords, currentKeywords = []) {
        const savedSet = savedKeywords instanceof Set ? savedKeywords : new Set(savedKeywords || []);
        const existingMap = new Map();

        currentKeywords.forEach((kw) => {
            const normalizedItem = this.normalizeKeywordItem(kw);
            if (!normalizedItem) return;
            existingMap.set(normalizedItem.normalized, Boolean(normalizedItem.required));
        });

        if (referenceText && referenceText.trim()) {
            const generated = this.buildKeywordsFromText(referenceText).map((item) => ({
                ...item,
                required: existingMap.has(item.normalized)
                    ? existingMap.get(item.normalized)
                    : savedSet.has(item.normalized)
            }));

            if (generated.length) {
                const extras = currentKeywords
                    .map((kw) => this.normalizeKeywordItem(kw))
                    .filter((kw) => kw && !generated.find((item) => item.normalized === kw.normalized));
                return [...generated, ...extras];
            }
        }

        const normalizedExisting = currentKeywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter(Boolean);
        if (normalizedExisting.length) {
            return normalizedExisting;
        }

        if (savedSet.size) {
            return Array.from(savedSet).map((normalized) => ({
                text: normalized,
                normalized,
                required: true
            }));
        }

        return [];
    }

    updateAddImageButtonState(count = 0) {
        const addBtn = document.querySelector('#add-image-btn');
        if (!addBtn) return;
        const label = addBtn.querySelector('.add-image-label');
        const isDisabled = count >= this.maxImages;
        addBtn.disabled = isDisabled;
        addBtn.classList.toggle('opacity-60', isDisabled);
        addBtn.classList.toggle('cursor-not-allowed', isDisabled);
        if (label) {
            label.textContent = isDisabled ? 'Лимит изображений' : 'Добавить изображение';
        }
    }

    setupDirtyTracking() {
        const selectors = [
            '#case-textarea',
            '#question-textarea',
            '#reference-textarea',
            '#hint-textarea',
            '#max-length-input',
        ];

        selectors.forEach((selector) => {
            const el = document.querySelector(selector);
            if (!el) return;
            const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, () => this.markUnsaved());
        });

        const questionsContainer = document.querySelector('#questions-container');
        if (questionsContainer && !questionsContainer.dataset.dirtyBound) {
            questionsContainer.dataset.dirtyBound = 'true';
            questionsContainer.addEventListener('input', () => this.markUnsaved());
            questionsContainer.addEventListener('change', () => this.markUnsaved());
        }

        document.querySelectorAll('input[name="display-mode"]').forEach((radio) => {
            if (!radio.dataset.dirtyBound) {
                radio.dataset.dirtyBound = 'true';
                radio.addEventListener('change', () => this.markUnsaved());
            }
        });
    }

    setupBeforeUnloadWarning() {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('reference_embed') === '1' || params.get('reference_preview') === '1') return;
        window.addEventListener('beforeunload', (event) => {
            if (!this.hasUnsavedChanges) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    markUnsaved() {
        if (this.isRendering) return;
        super.markUnsaved();
    }

    showToast(message, variant = 'success', duration = 2500, options = {}) {
        const existing = document.querySelector('#open-answer-toast');
        if (existing) {
            existing.remove();
        }
        if (this.toastHideTimer) {
            clearTimeout(this.toastHideTimer);
            this.toastHideTimer = null;
        }
        if (this.toastDismissTimer) {
            clearTimeout(this.toastDismissTimer);
            this.toastDismissTimer = null;
        }
        this.toastDismissCallback = null;

        const toast = document.createElement('div');
        toast.id = 'open-answer-toast';

        const baseClasses = [
            'fixed', 'bottom-6', 'right-6', 'z-[9999]',
            'px-4', 'py-3', 'rounded-lg', 'shadow-xl', 'border',
            'text-sm', 'font-medium', 'flex', 'items-center', 'gap-2',
            'transition-all', 'animate-slide-up'
        ];

        const variantClasses = variant === 'success'
            ? ['bg-success-lighter', 'text-success-text', 'border-success-text']
            : variant === 'warning'
                ? ['bg-warning-lighter', 'text-warning-text', 'border-warning-text']
                : variant === 'error'
                    ? ['bg-error-lighter', 'text-error-text', 'border-error-text']
                    : ['bg-surface-2', 'text-text-main', 'border-border-subtle'];

        toast.className = [...baseClasses, ...variantClasses].join(' ');
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-[18px]';
        icon.textContent = variant === 'success' ? 'task_alt' : variant === 'warning' ? 'warning' : variant === 'error' ? 'error' : 'info';
        const text = document.createElement('span');
        text.className = 'flex-1';
        text.textContent = message;
        toast.appendChild(icon);
        toast.appendChild(text);

        if (options.actionLabel && typeof options.onAction === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.dataset.toastAction = 'action';
            actionBtn.className = 'ml-2 inline-flex items-center rounded-md border border-current/20 px-2 py-1 text-xs font-semibold hover:bg-scrim-soft transition-colors';
            actionBtn.textContent = options.actionLabel;
            actionBtn.onclick = () => {
                const action = options.onAction;
                this.toastDismissCallback = null;
                try {
                    action();
                } finally {
                    toast.remove();
                }
            };
            toast.appendChild(actionBtn);
        }

        if (options.closeable) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.dataset.toastAction = 'close';
            closeBtn.className = 'ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-scrim-soft transition-colors';
            closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
            closeBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">close</span>';
            closeBtn.onclick = () => {
                this.toastDismissCallback = null;
                toast.remove();
            };
            toast.appendChild(closeBtn);
        }

        document.body.appendChild(toast);

        this.toastHideTimer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
        }, Math.max(duration - 250, 0));

        this.toastDismissCallback = () => {
            toast.remove();
            this.toastDismissCallback = null;
            if (this.toastHideTimer) {
                clearTimeout(this.toastHideTimer);
                this.toastHideTimer = null;
            }
            if (this.toastDismissTimer) {
                clearTimeout(this.toastDismissTimer);
                this.toastDismissTimer = null;
            }
        };
        this.toastDismissTimer = setTimeout(() => {
            if (this.toastDismissCallback) {
                this.toastDismissCallback();
            }
        }, duration);
    }

    setupImagePreviewControls() {
        this.imagePreviewOverlay = document.querySelector('#image-preview-overlay');
        this.imagePreviewContainer = document.querySelector('#image-preview-container');
        this.imagePreviewImg = document.querySelector('#image-preview-img');
        this.imagePreviewCloseBtn = document.querySelector('#image-preview-close');

        // State for Zoom/Pan
        this.transformState = {
            scale: 1,
            panning: false,
            pointX: 0,
            pointY: 0,
            startX: 0,
            startY: 0,
            initialized: false
        };

        if (this.imagePreviewCloseBtn) {
            this.imagePreviewCloseBtn.onclick = () => this.hideImagePreview();
        }

        if (this.imagePreviewOverlay) {
            this.imagePreviewOverlay.addEventListener('click', (event) => {
                if (event.target === this.imagePreviewOverlay) {
                    this.hideImagePreview();
                }
            });
        }

        // --- Zoom & Pan Event Listeners ---
        if (this.imagePreviewContainer && this.imagePreviewImg) {
            this.imagePreviewContainer.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
            this.imagePreviewContainer.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
            this.imagePreviewContainer.addEventListener('pointermove', (e) => this.handlePointerMove(e));
            this.imagePreviewContainer.addEventListener('pointerup', (e) => this.handlePointerUp(e));
            this.imagePreviewContainer.addEventListener('pointerleave', (e) => this.handlePointerUp(e));
        }
    }

    handleWheel(e) {
        if (!this.imagePreviewImg || !this.transformState.initialized) return;
        e.preventDefault();

        const containerRect = this.imagePreviewContainer.getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        const xs = (mouseX - this.transformState.pointX) / this.transformState.scale;
        const ys = (mouseY - this.transformState.pointY) / this.transformState.scale;

        const delta = -Math.sign(e.deltaY);
        const factor = Math.exp(0.12 * delta); // Slightly faster zoom

        let newScale = this.transformState.scale * factor;
        // Safety limits: don't zoom out past visibility, and don't zoom in to infinity
        newScale = Math.min(Math.max(0.01, newScale), 50);

        this.transformState.pointX = mouseX - xs * newScale;
        this.transformState.pointY = mouseY - ys * newScale;
        this.transformState.scale = newScale;

        this.updateImageTransform();
    }

    handlePointerDown(e) {
        if (!this.transformState.initialized || e.target.closest('#image-preview-close')) return;
        e.preventDefault();

        this.transformState.panning = true;

        const containerRect = this.imagePreviewContainer.getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        this.transformState.startX = mouseX - this.transformState.pointX;
        this.transformState.startY = mouseY - this.transformState.pointY;

        this.imagePreviewContainer.classList.add('cursor-grabbing');
        this.imagePreviewContainer.classList.remove('cursor-grab');
    }

    handlePointerMove(e) {
        if (!this.transformState.panning) return;
        e.preventDefault();

        const containerRect = this.imagePreviewContainer.getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        this.transformState.pointX = mouseX - this.transformState.startX;
        this.transformState.pointY = mouseY - this.transformState.startY;
        this.updateImageTransform();
    }

    handlePointerUp(e) {
        this.transformState.panning = false;
        if (this.imagePreviewContainer) {
            this.imagePreviewContainer.classList.remove('cursor-grabbing');
            this.imagePreviewContainer.classList.add('cursor-grab');
        }
    }

    updateImageTransform() {
        if (!this.imagePreviewImg) return;
        const { pointX, pointY, scale } = this.transformState;
        // Use translate3d for hardware acceleration and precise sub-pixel values
        this.imagePreviewImg.style.transform = `translate3d(${pointX.toFixed(4)}px, ${pointY.toFixed(4)}px, 0) scale(${scale.toFixed(4)})`;
    }

    initializeTransformState() {
        if (!this.imagePreviewImg || !this.imagePreviewContainer) return;

        // Use requestAnimationFrame to ensure the browser has laid out the image in its initial state
        requestAnimationFrame(() => {
            const imgRect = this.imagePreviewImg.getBoundingClientRect();
            const containerRect = this.imagePreviewContainer.getBoundingClientRect();
            const naturalWidth = this.imagePreviewImg.naturalWidth;
            const naturalHeight = this.imagePreviewImg.naturalHeight;

            if (imgRect.width === 0 || naturalWidth === 0 || containerRect.height < 50) {
                console.warn('[ImagePreview] ABORT: Invalid dimensions', { imgRect, containerRect });
                console.groupEnd();
                return;
            }

            // 1. Calculate the bridge between Flex layout and Absolute Positioning
            const initialScale = imgRect.width / naturalWidth;
            const startX = imgRect.left - containerRect.left;
            const startY = imgRect.top - containerRect.top;

            this.transformState.pointX = startX;
            this.transformState.pointY = startY;
            this.transformState.scale = initialScale;

            // 2. Switch to Absolute Positioning immediately
            const s = this.imagePreviewImg.style;
            s.width = `${naturalWidth}px`;
            s.height = 'auto';
            s.maxWidth = 'none';
            s.maxHeight = 'none';
            s.objectFit = 'fill';
            s.position = 'absolute';
            s.left = '0';
            s.top = '0';
            s.margin = '0';
            s.transformOrigin = '0 0';

            this.transformState.initialized = true;
            this.updateImageTransform();

            // 3. Reveal the image now that it is pinned
            s.opacity = '1';

            console.log('Takeover stats:', { initialScale, startX, startY });
            console.groupEnd();
        });
    }

    showImagePreview(imageUrl) {
        if (!this.imagePreviewOverlay || !this.imagePreviewImg) return;

        // Reset State
        this.transformState = {
            scale: 1,
            panning: false,
            pointX: 0,
            pointY: 0,
            startX: 0,
            startY: 0,
            initialized: false
        };

        // Reset Styles to Baseline
        const s = this.imagePreviewImg.style;
        s.opacity = '0'; // Hide until pinned to avoid first-frame jump
        s.transform = '';
        s.transformOrigin = 'center center';
        s.position = '';
        s.width = '';
        s.height = '';
        s.maxWidth = '100%';
        s.maxHeight = '100%';
        s.margin = '';
        s.objectFit = 'contain';

        // Proactive initialization on load
        this.imagePreviewImg.onload = () => this.initializeTransformState();

        this.imagePreviewImg.src = imageUrl;
        this.imagePreviewOverlay.classList.remove('hidden');
        this.imagePreviewOverlay.classList.add('flex');
        document.body.classList.add('overflow-hidden');
        document.addEventListener('keydown', this.handleGlobalKeyDown);
    }

    hideImagePreview() {
        if (!this.imagePreviewOverlay || !this.imagePreviewImg) return;
        this.imagePreviewOverlay.classList.add('hidden');
        this.imagePreviewOverlay.classList.remove('flex');

        this.imagePreviewImg.onload = null;
        this.imagePreviewImg.src = '';

        const s = this.imagePreviewImg.style;
        s.transform = '';
        s.position = '';
        s.left = '';
        s.top = '';
        s.width = '';
        s.height = '';
        s.maxWidth = '';
        s.maxHeight = '';
        s.margin = '';
        s.objectFit = '';
        s.opacity = '';

        document.body.classList.remove('overflow-hidden');
        document.removeEventListener('keydown', this.handleGlobalKeyDown);
    }

    applyAutoResize() {
        const areas = document.querySelectorAll('textarea[data-auto-resize="true"]');
        areas.forEach((area) => {
            if (!area || typeof area.addEventListener !== 'function') return;
            const resize = () => {
                area.style.height = 'auto';
                const minHeight = parseInt(area.getAttribute('data-min-height') || 0, 10);
                const nextHeight = Math.max(area.scrollHeight, minHeight || 0);
                area.style.height = `${nextHeight}px`;
            };
            if (!area.dataset.resizeBound) {
                area.addEventListener('input', resize);
                area.dataset.resizeBound = 'true';
            }
            resize();
        });
    }
}

if (typeof window !== 'undefined') {
    window.OpenAnswerEditor = OpenAnswerEditor;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof window !== 'undefined' && window.__OPEN_ANSWER_EDITOR_AUTO_INIT_DISABLED__) {
            return;
        }
        window.editor = new OpenAnswerEditor();
    });
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { OpenAnswerEditor };
}
