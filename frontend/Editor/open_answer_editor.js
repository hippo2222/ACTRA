/**
 * ACTRA Open Answer Editor
 */

const OPEN_ANSWER_ONBOARDING_TOUR_ID = 'open-answer-authoring';

class OpenAnswerEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task and this.hasUnsavedChanges are now inherited from BaseEditor

        // Open Answer Editor specific fields
        this.keywords = []; // Array of { text, normalized, required }
        this.savedKeywords = [];
        this.sequenceMatters = false;
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
        return {
            question: 'Как называется процесс обмена кислородом и углекислым газом в альвеолах?',
            prompt: 'Как называется процесс обмена кислородом и углекислым газом в альвеолах?',
            reference_answer: 'Этот процесс называется газообмен.',
            hint: 'Вспомните термин для обмена газами в альвеолах.',
            keywords: ['газообмен'],
            sequence_matters: false,
            maxLength: 420,
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
        this.keywords = this.task.task_data.content.keywords || [];
        this.sequenceMatters = Boolean(this.task.task_data.content.sequence_matters);
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    createEmptyOpenAnswerOnboardingContent() {
        return {
            question: '',
            prompt: '',
            reference_answer: '',
            hint: '',
            keywords: [],
            sequence_matters: false,
            images: [],
        };
    }

    resetOpenAnswerOnboardingPreviewState() {
        if (!this.openAnswerOnboardingPreview || !this.task || this.openAnswerOnboardingFinished) return;
        this.openAnswerOnboardingFinished = true;
        this.task.task_data.content = this.createEmptyOpenAnswerOnboardingContent();
        this.keywords = [];
        this.sequenceMatters = false;
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
        this.keywords = this.cloneOpenAnswerOnboardingValue(snapshot.keywords) || [];
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

        // Load keywords
        this.keywords = content.keywords || [];

        // Render UI
        this.renderUI();
        this.updateSaveStatus();
    }

    renderUI() {
        if (!this.task) return;

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
                'Задание';
            headerTitle.textContent = `Редактирование задания: ${humanName}`;
        }

        const content = this.task.task_data.content || {};

        // Text areas
        const questionArea = document.querySelector('#question-textarea');
        if (questionArea) questionArea.value = content.question || content.prompt || "";

        const referenceArea = document.querySelector('#reference-textarea');
        if (referenceArea) referenceArea.value = content.reference_answer || "";

        const hintArea = document.querySelector('#hint-textarea');
        if (hintArea) hintArea.value = content.hint || "";

        // Settings
        const maxLengthInput = document.querySelector('#max-length-input');
        if (maxLengthInput) {
            const resolvedMaxLength = this.resolveStoredMaxLength();
            maxLengthInput.value = resolvedMaxLength ? resolvedMaxLength.toString() : "";
        }

        const sequenceToggle = document.querySelector('#sequence-order-check');
        this.sequenceMatters = Boolean(content.sequence_matters ?? content.check_sequence);
        if (sequenceToggle) sequenceToggle.checked = this.sequenceMatters;

        this.savedKeywords = this.extractStoredKeywords(content.keywords);
        const referenceText = referenceArea ? referenceArea.value : "";
        this.keywords = this.extractKeywordCandidatesFromText(referenceText, this.savedKeywords, this.keywords);

        this.isRendering = true;
        this.renderKeywords();
        this.renderImages();
        this.applyAutoResize();
        this.isRendering = false;
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

    renderKeywords() {
        const container = document.querySelector('#keywords-container');
        const badge = document.querySelector('#selected-count-badge');
        if (!container) return;

        container.innerHTML = '';
        let selectedCount = 0;

        this.keywords = this.keywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter(Boolean);

        this.keywords.forEach((kw, index) => {
            const text = kw.text;
            const isRequired = Boolean(kw.required);
            if (isRequired) selectedCount++;

            const btn = document.createElement('button');
            btn.className = `keyword-tag pill pill-sm animate-pop-in hover:scale-105 ${isRequired ? 'active pill-info shadow-sm' : 'pill-neutral'}`;
            btn.textContent = text;

            btn.onclick = () => {
                this.keywords[index].required = !this.keywords[index].required;
                this.renderKeywords();
                this.markUnsaved();
            };

            container.appendChild(btn);
        });

        if (!this.keywords.length) {
            const placeholder = document.createElement('p');
            placeholder.className = 'open-answer-keywords-placeholder text-sm text-text-muted italic';
            placeholder.textContent = 'Добавьте ключевые слова или используйте кнопку «Разбить на ключевые слова».';
            container.appendChild(placeholder);
        }

        if (badge) badge.textContent = `Выбрано: ${selectedCount}`;
    }

    splitKeywords() {
        const referenceArea = document.querySelector('#reference-textarea');
        if (!referenceArea) return;

        const text = referenceArea.value || '';
        if (!text.trim()) {
            this.showToast('Сначала заполните эталонный ответ, чтобы выделить ключевые слова.', 'warning');
            referenceArea.focus();
            return;
        }

        const requiredLookup = new Set(
            this.keywords.filter((kw) => kw?.required).map((kw) => kw.normalized)
        );
        const generated = this.buildKeywordsFromText(text).map((kw) => ({
            ...kw,
            required: requiredLookup.has(kw.normalized),
        }));

        if (!generated.length) {
            this.showToast('Не удалось выделить ключевые слова. Проверьте эталонный ответ и попробуйте снова.', 'warning');
            return;
        }

        this.keywords = generated;
        this.renderKeywords();
        this.markUnsaved();
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
            emptyState.textContent = 'Изображения не добавлены';
            emptyState.innerHTML = `
                <span class="empty-state-card__icon">
                    <span class="material-symbols-outlined text-[22px]">imagesmode</span>
                </span>
                <h4 class="empty-state-card__title">Изображения не добавлены</h4>
                <p class="empty-state-card__copy">Добавьте до ${this.maxImages} ссылок или изображений для задачи.</p>
            `;
            container.insertBefore(emptyState, referenceNode);
        }

        this.updateAddImageButtonState(images.length);
    }

    setupEventListeners() {
        // Back
        const backBtn = document.querySelector('#back-to-dashboard-btn');
        if (backBtn) {
            backBtn.onclick = () => this.goBack();
        }

        // Split button
        const splitBtn = document.querySelector('#split-keywords-btn');
        if (splitBtn) splitBtn.onclick = () => this.splitKeywords();

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
            this.showToast(`Можно загрузить не более ${this.maxImages} изображений.`, 'warning');
            event.target.value = '';
            return;
        }

        const filesToUpload = files.slice(0, remainingSlots);
        if (filesToUpload.length < files.length) {
            this.showToast(`Загружено максимальное количество файлов (${this.maxImages}).`, 'warning');
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

                const data = await response.json();
                if (response.ok !== false && data.ok && (data.path || data.asset_id || data.asset_url)) {
                    if (!this.task.task_data.content.images) this.task.task_data.content.images = [];
                    const nextImageRef = this.serializeImageReference({
                        path: data.path,
                        asset_id: data.asset_id,
                        asset_url: data.asset_url,
                    });
                    if (!nextImageRef) {
                        this.showToast('Не удалось подготовить ссылку на изображение.', 'error');
                        continue;
                    }
                    this.task.task_data.content.images.push(nextImageRef);
                    this.task.task_data.content.images = this.normalizeContentImages(this.task.task_data.content.images);
                    this.markUnsaved();
                } else {
                    this.showToast(`Ошибка загрузки: ${data.error || 'upload_failed'}`, 'error');
                }
            } catch (error) {
                console.error("Ошибка загрузки изображения:", error);
                this.showToast('Ошибка загрузки изображения. Проверьте соединение и попробуйте снова.', 'error');
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
        this.showToast('Изображение удалено.', 'info', 5000, {
            actionLabel: 'Отменить',
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
        this.showToast('Изображение восстановлено.', 'success');
        return true;
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        const questionArea = document.querySelector('#question-textarea');
        const prompt = questionArea ? questionArea.value.trim() : "";

        const referenceArea = document.querySelector('#reference-textarea');
        const referenceAnswer = referenceArea ? referenceArea.value.trim() : "";
        const maxLengthInput = document.querySelector('#max-length-input');
        const maxLengthPreference = this.readMaxLengthPreference();

        // Validate prompt
        if (!prompt) {
            if (questionArea) questionArea.focus();
            return "Ошибка: поле вопроса не должно быть пустым.";
        }

        // Validate reference answer
        if (!referenceAnswer) {
            if (referenceArea) referenceArea.focus();
            return "Ошибка: эталонный ответ не должен быть пустым.";
        }

        if (maxLengthPreference.invalid) {
            if (maxLengthInput) maxLengthInput.focus();
            return "Ошибка: максимальная длина ответа должна быть целым числом не меньше 1 или пустым полем.";
        }

        // Validate keywords
        const normalizedKeywords = this.keywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter((kw) => kw && kw.required);

        if (!normalizedKeywords.length) {
            return "Ошибка: добавьте хотя бы одно ключевое слово для проверки.";
        }

        const keywordsTexts = normalizedKeywords.map((kw) => kw.text).filter(Boolean);

        if (!keywordsTexts.length) {
            return "Ошибка: выберите хотя бы одно ключевое слово.";
        }

        return null; // Validation passed
    }

    /**
     * Build task data for saving to backend (BaseEditor abstract method)
     * @returns {Object} Task data object
     */
    buildTaskData() {
        const questionArea = document.querySelector('#question-textarea');
        const prompt = questionArea ? questionArea.value.trim() : "";

        const referenceArea = document.querySelector('#reference-textarea');
        const referenceAnswer = referenceArea ? referenceArea.value.trim() : "";

        const hintField = document.querySelector('#hint-textarea');
        const hint = hintField ? hintField.value.trim() : "";

        const content = this.task.task_data.content;
        const maxLengthPreference = this.readMaxLengthPreference();
        const maxLength = maxLengthPreference.isSet && !maxLengthPreference.invalid
            ? maxLengthPreference.value
            : null;

        const normalizedKeywords = this.keywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter((kw) => kw && kw.required);

        const keywordsTexts = normalizedKeywords.map((kw) => kw.text).filter(Boolean);

        // Build content
        content.question = prompt;
        content.prompt = prompt;
        content.reference_answer = referenceAnswer;

        if (hint) {
            content.hint = hint;
        } else {
            delete content.hint;
        }

        if (maxLength != null) {
            content.max_length = maxLength;
        } else {
            delete content.max_length;
            delete content.maxLength;
        }
        delete content.min_keywords;
        delete content.require_all_keywords;
        content.sequence_matters = this.sequenceMatters;
        content.keywords = keywordsTexts;
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
        // Use buildTaskData to get the current state
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
        const content = this.task.task_data.content;
        this.sequenceMatters = Boolean(content.sequence_matters ?? content.check_sequence);
        this.keywords = content.keywords || [];

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
