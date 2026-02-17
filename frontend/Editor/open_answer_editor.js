/**
 * ACTRA Open Answer Editor
 */

const DEFAULT_MAX_LENGTH = 1000;

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
        this.handleGlobalKeyDown = (event) => {
            if (event.key === 'Escape') {
                this.hideImagePreview();
            }
        };

        this.init();
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
        this.setupDirtyTracking();
        this.setupBeforeUnloadWarning();
    }

    /**
     * Called after task is loaded from backend (BaseEditor hook)
     */
    onTaskLoaded() {
        const content = this.task.task_data.content || {};
        this.task.task_data.content = content;

        // Ensure images array exists
        if (!Array.isArray(content.images)) {
            content.images = [];
        }

        // Set max_length with default
        const storedMaxLength = Number(content.max_length);
        content.max_length = Number.isFinite(storedMaxLength) && storedMaxLength > 0
            ? storedMaxLength
            : DEFAULT_MAX_LENGTH;

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
        const minKeywordsInput = document.querySelector('#min-keywords-input');
        if (minKeywordsInput) {
            const hasStoredValue = typeof content.min_keywords === 'number' && !Number.isNaN(content.min_keywords);
            const requireAll = content.require_all_keywords === true || !hasStoredValue;
            if (requireAll) {
                minKeywordsInput.value = "-1";
            } else {
                minKeywordsInput.value = content.min_keywords.toString();
            }
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
            btn.className = `px-3 py-1 rounded-full text-sm font-medium border transition-all keyword-tag animate-pop-in hover:scale-105 ${isRequired ? 'active bg-primary text-primary-contrast shadow-sm ring-2 ring-primary border-transparent' : 'bg-surface-2 text-text-muted hover:bg-bg-hover border-border-subtle'}`;
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
            placeholder.className = 'text-sm text-text-muted italic';
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
            alert('Сначала заполните эталонный ответ, чтобы выделить ключевые слова.');
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
            alert('Не удалось выделить ключевые слова. Попробуйте добавить их вручную.');
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
        let images = Array.isArray(content.images) ? content.images.filter(Boolean) : [];
        if (images.length > this.maxImages) {
            images = images.slice(0, this.maxImages);
            content.images = images;
        }

        container.querySelectorAll('.open-answer-image-card, .images-empty-state').forEach((el) => el.remove());

        const addBtn = document.querySelector('#add-image-btn');
        const referenceNode = addBtn || container.lastElementChild;

        images.forEach((path, index) => {
            const div = document.createElement('div');
            div.className = 'open-answer-image-card group relative aspect-square bg-surface-2 rounded-lg border border-border-subtle overflow-hidden animate-scale-in hover:shadow-lg transition-all hover:translate-y-[-2px]';

            const fullPath = `/api/editor/image?path=${encodeURIComponent(path)}`;

            div.innerHTML = `
                <div class="absolute inset-0 flex items-center justify-center bg-bg-hover text-text-disabled">
                    <span class="material-symbols-outlined text-[32px]">image</span>
                </div>
                <img alt="Reference Image" class="absolute inset-0 w-full h-full object-cover" src="${fullPath}" />
                <div class="absolute inset-0 bg-scrim opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button class="p-1.5 bg-surface-1 hover:bg-surface-1 text-text-main rounded-full backdrop-blur-sm transition-colors view-btn shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                    </button>
                    <button class="p-1.5 bg-error hover:bg-error-dark text-text-on-dark rounded-full backdrop-blur-sm transition-colors delete-btn shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            `;

            const deleteBtn = div.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.onclick = () => {
                    this.task.task_data.content.images.splice(index, 1);
                    this.renderImages();
                    this.markUnsaved();
                };
            }

            const viewBtn = div.querySelector('.view-btn');
            if (viewBtn) {
                viewBtn.onclick = () => this.showImagePreview(fullPath);
            }

            container.insertBefore(div, referenceNode);
        });

        if (!images.length) {
            const emptyState = document.createElement('div');
            emptyState.className = 'images-empty-state col-span-4 text-sm text-text-muted border border-dashed border-border-subtle rounded-lg py-6 text-center';
            emptyState.textContent = 'Изображения не добавлены';
            container.insertBefore(emptyState, referenceNode);
        }

        this.updateAddImageButtonState(images.length);
    }

    setupEventListeners() {
        // Back
        const backBtn = document.querySelector('#back-to-dashboard-btn');
        if (backBtn) {
            backBtn.onclick = () => {
                if (this.hasUnsavedChanges) {
                    const confirmed = window.confirm('Есть несохранённые изменения. Выйти без сохранения?');
                    if (!confirmed) return;
                }
                window.navigateWithTransition('/ui/editor');
            };
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
        if (!Array.isArray(content.images)) {
            content.images = [];
        }

        const remainingSlots = this.maxImages - content.images.length;
        if (remainingSlots <= 0) {
            alert(`Можно загрузить не более ${this.maxImages} изображений.`);
            event.target.value = '';
            return;
        }

        const filesToUpload = files.slice(0, remainingSlots);
        if (filesToUpload.length < files.length) {
            alert(`Загружено максимальное количество файлов (${this.maxImages}).`);
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
                if (data.ok) {
                    if (!this.task.task_data.content.images) this.task.task_data.content.images = [];
                    this.task.task_data.content.images.push(data.path);
                    this.markUnsaved();
                } else {
                    alert("Ошибка загрузки: " + data.error);
                }
            } catch (error) {
                console.error("Ошибка загрузки изображения:", error);
            }
        }
        this.renderImages();
        event.target.value = '';
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

        const minKeywordsInput = document.querySelector('#min-keywords-input');
        let minKeywords = minKeywordsInput ? parseInt(minKeywordsInput.value, 10) : -1;
        if (Number.isNaN(minKeywords)) {
            minKeywords = -1;
        }

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

        // Validate keywords
        const normalizedKeywords = this.keywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter((kw) => kw && kw.required);

        if (!normalizedKeywords.length) {
            return "Ошибка: добавьте хотя бы одно ключевое слово для проверки.";
        }

        const requireAllKeywords = minKeywords === -1;

        if (!requireAllKeywords && (isNaN(minKeywords) || minKeywords < 1)) {
            if (minKeywordsInput) minKeywordsInput.focus();
            return "Ошибка: минимальное количество ключевых слов должно быть не меньше 1.";
        }

        const keywordsTexts = normalizedKeywords.map((kw) => kw.text).filter(Boolean);

        if (!keywordsTexts.length) {
            return "Ошибка: выберите хотя бы одно ключевое слово.";
        }

        if (!requireAllKeywords && minKeywords > keywordsTexts.length) {
            if (minKeywordsInput) minKeywordsInput.focus();
            return `Ошибка: минимальное количество ключевых слов (${minKeywords}) не может превышать общее число ключевых слов (${keywordsTexts.length}).`;
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
        const maxLengthValue = Number(content?.max_length);
        const maxLength = Number.isFinite(maxLengthValue) && maxLengthValue > 0
            ? maxLengthValue
            : DEFAULT_MAX_LENGTH;

        const minKeywordsInput = document.querySelector('#min-keywords-input');
        let minKeywords = minKeywordsInput ? parseInt(minKeywordsInput.value, 10) : -1;
        if (Number.isNaN(minKeywords)) {
            minKeywords = -1;
        }

        const normalizedKeywords = this.keywords
            .map((kw) => this.normalizeKeywordItem(kw))
            .filter((kw) => kw && kw.required);

        const requireAllKeywords = minKeywords === -1;
        const keywordsTexts = normalizedKeywords.map((kw) => kw.text).filter(Boolean);

        if (requireAllKeywords) {
            minKeywords = keywordsTexts.length || 1;
        }

        // Build content
        content.question = prompt;
        content.prompt = prompt;
        content.reference_answer = referenceAnswer;

        if (hint) {
            content.hint = hint;
        } else {
            delete content.hint;
        }

        content.max_length = maxLength;
        content.min_keywords = minKeywords;
        content.require_all_keywords = requireAllKeywords;
        content.sequence_matters = this.sequenceMatters;
        content.keywords = keywordsTexts;
        content.images = Array.isArray(content.images)
            ? content.images.slice(0, this.maxImages)
            : [];

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
            '#min-keywords-input'
        ];

        selectors.forEach((selector) => {
            const el = document.querySelector(selector);
            if (!el) return;
            const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, () => this.markUnsaved());
        });
    }

    setupBeforeUnloadWarning() {
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

    showToast(message, variant = 'success', duration = 2500) {
        const existing = document.querySelector('#open-answer-toast');
        if (existing) {
            existing.remove();
        }

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
            : ['bg-surface-2', 'text-text-main', 'border-border-subtle'];

        toast.className = [...baseClasses, ...variantClasses].join(' ');
        toast.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">${variant === 'success' ? 'task_alt' : 'info'}</span>
            <span>${message}</span>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
        }, Math.max(duration - 250, 0));

        setTimeout(() => toast.remove(), duration);
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
        window.editor = new OpenAnswerEditor();
    });
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { OpenAnswerEditor };
}
