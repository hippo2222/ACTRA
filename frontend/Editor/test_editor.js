function wt(key, fallback) {
  if (window.i18n && typeof window.i18n.t === 'function') {
    var v = window.i18n.t(key);
    if (v !== key) return v;
  }
  return fallback;
}

﻿/**
 * ACTRA Test Task Editor (Multiple Choice)
 */

const TEST_EDITOR_ONBOARDING_TOUR_ID = 'test-editor-authoring';

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
        this.importSource = 'file';
        this.importMode = 'append';
        this.initialSnapshot = null;
        this.isQuestionImageUploading = false;
        this.maxQuestionImages = 3;
        this.uploadingOptionImageIndex = null;
        this.activeImagePasteTarget = null;
        this.selectedBankImageItem = null;
        this.isImageBankExpanded = true;
        this.pendingPastedImageFile = null;
        this.isPasteImageTargetMode = false;
        this.pendingQuestionDeletion = null;
        this.questionDeletionUndoMs = 6000;
        this.testEditorOnboardingPreview = new URLSearchParams(window.location.search)
            .get('onboarding_preview') === TEST_EDITOR_ONBOARDING_TOUR_ID;
        this.testEditorOnboardingImportVariantActive = false;
        this.testEditorOnboardingImportMarkerTimer = 0;
        this.testEditorOnboardingFinished = false;
        this.testEditorOnboardingDemoSnapshot = null;
        this.testEditorOnboardingDemoActive = false;
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

    normalizeImagePasteTarget(target) {
        if (!target || typeof target !== 'object') return null;
        if (target.kind === 'question') {
            return { kind: 'question' };
        }
        if (target.kind === 'option') {
            const index = Number(target.index);
            if (!Number.isInteger(index) || index < 0) return null;
            return { kind: 'option', index };
        }
        return null;
    }

    isSameImagePasteTarget(a, b) {
        const left = this.normalizeImagePasteTarget(a);
        const right = this.normalizeImagePasteTarget(b);
        if (!left && !right) return true;
        if (!left || !right) return false;
        return left.kind === right.kind && left.index === right.index;
    }

    resolveImagePasteTargetFromElement(element) {
        if (!element || element.nodeType !== 1 || typeof element.closest !== 'function') {
            return null;
        }
        const targetNode = element.closest('[data-image-paste-target]');
        if (!targetNode) return null;

        if (targetNode.dataset.imagePasteTarget === 'question') {
            return { kind: 'question' };
        }

        if (targetNode.dataset.imagePasteTarget === 'option') {
            const rawIndex = targetNode.dataset.optionIndex;
            const index = Number(rawIndex);
            if (Number.isInteger(index) && index >= 0) {
                return { kind: 'option', index };
            }
        }

        return null;
    }

    setActiveImagePasteTarget(target) {
        const normalizedTarget = this.normalizeImagePasteTarget(target);
        if (this.isSameImagePasteTarget(this.activeImagePasteTarget, normalizedTarget)) {
            return;
        }
        this.activeImagePasteTarget = normalizedTarget;
        this.syncActiveImagePasteTargetUI();
    }

    syncActiveImagePasteTargetUI() {
        document.body.classList.toggle('paste-image-selection-mode', Boolean(this.isPasteImageTargetMode));

        const questionCard = document.querySelector('.question-paste-card');
        const questionDock = document.querySelector('.question-media-dock');
        if (questionCard) {
            questionCard.classList.toggle('is-paste-selectable', Boolean(this.isPasteImageTargetMode));
            questionCard.classList.toggle('is-paste-target', this.activeImagePasteTarget?.kind === 'question');
        }
        if (questionDock) {
            questionDock.classList.toggle('is-paste-target', this.activeImagePasteTarget?.kind === 'question');
        }

        document.querySelectorAll('#options-container .option-row').forEach((row, index) => {
            const isOptionTarget = this.activeImagePasteTarget?.kind === 'option'
                && this.activeImagePasteTarget.index === index;
            row.classList.toggle('is-paste-selectable', Boolean(this.isPasteImageTargetMode));
            row.classList.toggle('is-paste-target', isOptionTarget);
        });
    }

    syncBankImageTargetUI() {
        const selected = this.selectedBankImageItem;
        document.body.classList.toggle('bank-image-placement-mode', Boolean(selected));

        const q = this.questions[this.currentQuestionIndex];
        const selectedKey = selected ? this.getImageReferenceKey(selected.ref) : "";
        const questionKeys = new Set(this.syncQuestionLegacyImageFields(q).map((ref) => this.getImageReferenceKey(ref)));
        const canUseQuestionTarget = Boolean(
            selected
            && q
            && !questionKeys.has(selectedKey)
            && questionKeys.size < this.getMaxQuestionImages()
        );

        const questionCard = document.querySelector('.question-paste-card');
        const questionDock = document.querySelector('.question-media-dock');
        [questionCard, questionDock].forEach((node) => {
            if (!node) return;
            node.classList.toggle('is-bank-selectable', canUseQuestionTarget);
        });

        document.querySelectorAll('#options-container .option-row').forEach((row) => {
            row.classList.toggle('is-bank-selectable', Boolean(selected));
        });
    }

    isModalVisible(modal) {
        return Boolean(modal && !modal.classList.contains('hidden'));
    }

    shouldSuppressImagePasteForElement(element) {
        if (this.isModalVisible(this.pasteImageTargetModal)) {
            return true;
        }
        if (!element || element.nodeType !== 1 || typeof element.closest !== 'function') {
            return false;
        }
        if (this.isModalVisible(this.importModal) && element.closest('#import-modal')) {
            return true;
        }
        return false;
    }

    buildImageUploadFormData(file) {
        const formData = new FormData();
        formData.append('file', file);
        const ctx = this.getImageRequestContext();
        if (ctx.module) formData.append('module', ctx.module);
        if (ctx.topic) formData.append('topic', ctx.topic);
        if (ctx.task) formData.append('task', ctx.task);
        return formData;
    }

    async uploadImageFileForQuestion(file) {
        if (!file) return false;
        const q = this.questions[this.currentQuestionIndex];
        if (!q) return false;
        const existingImages = this.syncQuestionLegacyImageFields(q);
        if (existingImages.length >= this.getMaxQuestionImages()) {
            this.showToast(wt('xt.k001', 'Можно добавить не больше 3 изображений к вопросу'), 'warning');
            this.syncQuestionImageBusyState();
            return false;
        }
        if (this.isQuestionImageUploading) {
            this.showToast(wt('xt.k002', 'Подождите завершения загрузки изображения вопроса'), 'warning');
            return false;
        }

        this.isQuestionImageUploading = true;
        this.syncQuestionImageBusyState();

        try {
            const data = await this.requestJson('/api/editor/upload-image', {
                method: 'POST',
                body: this.buildImageUploadFormData(file)
            });

            const nextRef = this.serializeImageReference({
                path: data.path,
                asset_id: data.asset_id,
                asset_url: data.asset_url,
            });
            if (!nextRef) {
                this.showToast(wt('xt.k003', 'Сервер не вернул ссылку на изображение'), 'error');
                return false;
            }

            q.images = [...existingImages, nextRef];
            this.syncQuestionLegacyImageFields(q);
            this.renderCurrentQuestion();
            this.renderQuestionList();
            this.showToast(wt('xt.k004', 'Изображение вопроса добавлено'), 'success');
            this.markUnsavedChanges();
            return true;
        } catch (error) {
            console.error('Error uploading image:', error);
            this.showToast(error.message || wt('xt.k005', 'Ошибка загрузки изображения'), 'error');
            return false;
        } finally {
            this.isQuestionImageUploading = false;
            this.syncQuestionImageBusyState();
        }
    }

    async uploadImageFileForOption(file, targetIndex) {
        if (!file) return false;
        if (!Number.isInteger(targetIndex) || targetIndex < 0) return false;

        const currentQuestion = this.questions[this.currentQuestionIndex];
        if (!currentQuestion || !currentQuestion.options[targetIndex]) {
            return false;
        }
        if (Number.isInteger(this.uploadingOptionImageIndex)) {
            this.showToast(wt('xt.k006', 'Подождите завершения загрузки изображения варианта'), 'warning');
            return false;
        }

        this.uploadingOptionImageIndex = targetIndex;
        this.syncOptionImageBusyState();

        try {
            const data = await this.requestJson('/api/editor/upload-image', {
                method: 'POST',
                body: this.buildImageUploadFormData(file)
            });

            currentQuestion.options[targetIndex].image_path = data.path || null;
            currentQuestion.options[targetIndex].image_asset_id = data.asset_id || null;
            currentQuestion.options[targetIndex].image_asset_url = data.asset_url || null;
            this.uploadingOptionImageIndex = null;
            this.renderOptions();
            this.renderQuestionList();
            this.showToast(wt('xt.k007', 'Изображение варианта обновлено'), 'success');
            this.markUnsavedChanges();
            return true;
        } catch (error) {
            this.showToast(error.message || wt('xt.k008', 'Ошибка загрузки изображения варианта'), 'error');
            return false;
        } finally {
            this.uploadingOptionImageIndex = null;
            this.syncOptionImageBusyState();
        }
    }

    async uploadImageFileForTarget(file, target) {
        const normalizedTarget = this.normalizeImagePasteTarget(target);
        if (!normalizedTarget) return false;
        if (normalizedTarget.kind === 'question') {
            return this.uploadImageFileForQuestion(file);
        }
        return this.uploadImageFileForOption(file, normalizedTarget.index);
    }

    clearPendingPastedImage() {
        this.pendingPastedImageFile = null;
    }

    showPasteImageTargetModal(show) {
        if (!this.pasteImageTargetModal) return;
        if (show) {
            this.pasteImageTargetModal.classList.remove('hidden');
        } else {
            this.pasteImageTargetModal.classList.add('hidden');
        }
    }

    setPasteImageTargetMode(active) {
        this.isPasteImageTargetMode = Boolean(active);
        if (this.pasteImageTargetDescription) {
            this.pasteImageTargetDescription.textContent = this.isPasteImageTargetMode
                ? wt('xt.k009', 'Выберите карточку вопроса или карточку варианта ответа, куда нужно прикрепить изображение.')
                : '';
        }
        this.showPasteImageTargetModal(this.isPasteImageTargetMode);
        this.syncActiveImagePasteTargetUI();
    }

    hidePasteImageTargetModal(clearPending = false) {
        if (clearPending) {
            this.clearPendingPastedImage();
        }
        this.setPasteImageTargetMode(false);
    }

    openPasteImageTargetModal(file) {
        this.pendingPastedImageFile = file;
        this.setPasteImageTargetMode(true);
    }

    async applyPendingPastedImage(target) {
        const file = this.pendingPastedImageFile;
        if (!file) {
            this.hidePasteImageTargetModal(true);
            return;
        }

        this.hidePasteImageTargetModal(true);
        await this.uploadImageFileForTarget(file, target);
    }

    async handlePasteTargetSelectionClick(event) {
        if (!this.isPasteImageTargetMode) return;
        const targetNode = event?.target?.nodeType === 1 ? event.target : null;
        if (!targetNode) return;

        if (targetNode.closest('#paste-image-target-cancel, #paste-image-target-close')) {
            event.preventDefault();
            event.stopPropagation();
            this.hidePasteImageTargetModal(true);
            return;
        }

        const target = this.resolveImagePasteTargetFromElement(targetNode);
        if (target) {
            event.preventDefault();
            event.stopPropagation();
            this.setActiveImagePasteTarget(target);
            await this.applyPendingPastedImage(target);
            return;
        }

        if (typeof targetNode.closest === 'function' && !targetNode.closest('#paste-image-target-modal')) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    handlePasteTargetSelectionKeydown(event) {
        if (!this.isPasteImageTargetMode) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.hidePasteImageTargetModal(true);
        }
    }

    handleGlobalFocusIn(event) {
        this.setActiveImagePasteTarget(this.resolveImagePasteTargetFromElement(event.target));
    }

    async handleClipboardPaste(event) {
        const eventTarget = event?.target?.nodeType === 1 ? event.target : document.activeElement;
        if (this.shouldSuppressImagePasteForElement(eventTarget)) {
            return;
        }

        const imageFile = await this.extractImageFileFromClipboardEvent(event);
        if (!imageFile) return;

        event.preventDefault();

        const explicitTarget = this.resolveImagePasteTargetFromElement(eventTarget)
            || this.resolveImagePasteTargetFromElement(document.activeElement);

        if (explicitTarget) {
            this.setActiveImagePasteTarget(explicitTarget);
            await this.uploadImageFileForTarget(imageFile, explicitTarget);
            return;
        }

        this.openPasteImageTargetModal(imageFile);
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
            if (value.startsWith("/api/assets/") || value.startsWith("/api/editor/image") || value.startsWith("/api/local-image") || /^(https?:|data:)/i.test(value)) {
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
        const nestedImagePath = raw.image_path && typeof raw.image_path === "object" ? raw.image_path : null;
        const path = String(
            raw.path ??
            (typeof raw.image_path === "string" ? raw.image_path : null) ??
            (typeof raw.image === "string" ? raw.image : null) ??
            raw.src ??
            nested?.path ??
            nested?.image_path ??
            nested?.src ??
            nestedImagePath?.path ??
            nestedImagePath?.image_path ??
            nestedImagePath?.src ??
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
                nestedImagePath?.asset_url ??
                nestedImagePath?.image_asset_url ??
                nestedImagePath?.image_url ??
                nestedImagePath?.url ??
                ""
            )
        ).trim();
        const asset_id = String(
            fallbackAssetId || (
                raw.asset_id ??
                raw.image_asset_id ??
                nested?.asset_id ??
                nested?.image_asset_id ??
                nestedImagePath?.asset_id ??
                nestedImagePath?.image_asset_id ??
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

    getMaxQuestionImages() {
        return Number.isInteger(this.maxQuestionImages) && this.maxQuestionImages > 0
            ? this.maxQuestionImages
            : 3;
    }

    serializeImageReference(raw) {
        const ref = this.normalizeImageReference(raw);
        const payload = {};
        if (ref.path) payload.path = ref.path;
        if (ref.asset_id) payload.asset_id = ref.asset_id;
        if (ref.asset_url) payload.asset_url = ref.asset_url;
        return Object.keys(payload).length ? payload : null;
    }

    getImageReferenceKey(raw) {
        const ref = this.normalizeImageReference(raw);
        return ref.asset_url || (ref.asset_id ? `asset:${ref.asset_id}` : "") || ref.path || "";
    }

    getOptionLabel(index) {
        if (!Number.isInteger(index) || index < 0) return "";
        return String.fromCharCode(65 + index);
    }

    collectImageBankItems() {
        const items = [];
        const byKey = new Map();

        const pushRef = (rawRef, sourceLabel) => {
            const ref = this.serializeImageReference(rawRef);
            if (!ref) return;
            const key = this.getImageReferenceKey(ref);
            if (!key) return;

            const existing = byKey.get(key);
            if (existing) {
                existing.usageCount += 1;
                if (sourceLabel) existing.sources.push(sourceLabel);
                return;
            }

            const item = {
                key,
                ref,
                usageCount: 1,
                sources: sourceLabel ? [sourceLabel] : [],
            };
            byKey.set(key, item);
            items.push(item);
        };

        (this.questions || []).forEach((question, questionIndex) => {
            const questionLabel = `${wt('xt.k010', 'Вопрос ')}${questionIndex + 1}`;
            this.buildQuestionImageRefs(question).forEach((ref) => {
                pushRef(ref, questionLabel);
            });

            (question?.options || []).forEach((option, optionIndex) => {
                pushRef({
                    path: option?.image_path,
                    asset_id: option?.image_asset_id,
                    asset_url: option?.image_asset_url,
                }, `${questionLabel}${wt('xt.k011', ', вариант ')}${this.getOptionLabel(optionIndex)}`);
            });
        });

        return items;
    }

    clearSelectedImageBankItem({ render = true } = {}) {
        this.selectedBankImageItem = null;
        this.syncBankImageTargetUI();
        if (render) {
            this.renderImageBank();
        }
    }

    selectImageBankItem(item) {
        if (!item?.ref) return;
        const key = this.getImageReferenceKey(item.ref);
        if (!key) return;
        const currentKey = this.selectedBankImageItem?.key || "";
        if (currentKey === key) {
            this.clearSelectedImageBankItem();
            return;
        }
        this.selectedBankImageItem = {
            key,
            ref: { ...item.ref },
            usageCount: item.usageCount || 1,
            sources: Array.isArray(item.sources) ? [...item.sources] : [],
        };
        this.syncBankImageTargetUI();
        this.renderImageBank();
    }

    addImageReferenceToCurrentQuestion(rawRef) {
        const q = this.questions[this.currentQuestionIndex];
        const ref = this.serializeImageReference(rawRef);
        if (!q || !ref) return false;

        const existingImages = this.syncQuestionLegacyImageFields(q);
        const key = this.getImageReferenceKey(ref);
        const alreadyAttached = existingImages.some((existingRef) => this.getImageReferenceKey(existingRef) === key);
        if (alreadyAttached) {
            this.showToast(wt('xt.k012', 'Изображение уже добавлено к вопросу'), 'info');
            return false;
        }

        if (existingImages.length >= this.getMaxQuestionImages()) {
            this.showToast(wt('xt.k013', 'К вопросу уже добавлено 3 изображения'), 'warning');
            return false;
        }

        q.images = [...existingImages, { ...ref }];
        this.syncQuestionLegacyImageFields(q);
        this.renderCurrentQuestion();
        this.renderQuestionList();
        this.showToast(wt('xt.k014', 'Изображение добавлено к вопросу'), 'success');
        this.markUnsavedChanges();
        return true;
    }

    addImageReferenceToOption(rawRef, optionIndex) {
        const q = this.questions[this.currentQuestionIndex];
        const ref = this.serializeImageReference(rawRef);
        if (!q || !ref || !Number.isInteger(optionIndex) || optionIndex < 0 || !q.options?.[optionIndex]) {
            return false;
        }

        q.options[optionIndex].image_path = ref.path || null;
        q.options[optionIndex].image_asset_id = ref.asset_id || null;
        q.options[optionIndex].image_asset_url = ref.asset_url || null;
        this.renderOptions();
        this.renderQuestionList();
        this.showToast(`${wt('xt.k015', 'Изображение добавлено к варианту ')}${this.getOptionLabel(optionIndex)}`, 'success');
        this.markUnsavedChanges();
        return true;
    }

    applySelectedBankImageToTarget(target) {
        const selected = this.selectedBankImageItem;
        const normalizedTarget = this.normalizeImagePasteTarget(target);
        if (!selected || !normalizedTarget) return false;

        let applied = false;
        if (normalizedTarget.kind === 'question') {
            applied = this.addImageReferenceToCurrentQuestion(selected.ref);
        } else if (normalizedTarget.kind === 'option') {
            applied = this.addImageReferenceToOption(selected.ref, normalizedTarget.index);
        }

        if (applied) {
            this.clearSelectedImageBankItem();
        } else {
            this.syncBankImageTargetUI();
            this.renderImageBank();
        }
        return applied;
    }

    handleBankImageTargetSelectionClick(event) {
        if (!this.selectedBankImageItem) return;
        const targetNode = event?.target?.nodeType === 1 ? event.target : null;
        if (!targetNode) return;

        if (
            targetNode.closest('.test-image-bank')
            || targetNode.closest('.test-image-bank-viewer')
            || targetNode.closest('#paste-image-target-modal')
            || targetNode.closest('#import-modal')
        ) {
            return;
        }

        const target = this.resolveImagePasteTargetFromElement(targetNode);
        if (target) {
            event.preventDefault();
            event.stopPropagation();
            this.applySelectedBankImageToTarget(target);
            return;
        }

        this.clearSelectedImageBankItem();
    }

    handleBankImageTargetSelectionKeydown(event) {
        if (!this.selectedBankImageItem) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.clearSelectedImageBankItem();
        }
    }

    openImageBankViewer(imgSrc, caption = wt('xt.k016', 'Изображение')) {
        if (!imgSrc) return;

        const existing = document.querySelector('.test-image-bank-viewer');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'test-image-bank-viewer';
        overlay.tabIndex = -1;

        const container = document.createElement('section');
        container.className = 'test-image-bank-viewer__panel';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        container.setAttribute('aria-label', wt('xt.k017', 'Просмотр изображения'));

        const topBar = document.createElement('div');
        topBar.className = 'test-image-bank-viewer__toolbar';

        const title = document.createElement('div');
        title.className = 'test-image-bank-viewer__title';
        title.textContent = caption || wt('xt.k016', 'Изображение');

        const controls = document.createElement('div');
        controls.className = 'test-image-bank-viewer__controls';

        const makeButton = (label, ariaLabel, className = '') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `test-image-bank-viewer__button ${className}`.trim();
            button.textContent = label;
            button.title = ariaLabel;
            button.setAttribute('aria-label', ariaLabel);
            return button;
        };

        const zoomOutBtn = makeButton('-', wt('xt.k018', 'Уменьшить'));
        const scaleBadge = document.createElement('span');
        scaleBadge.className = 'test-image-bank-viewer__scale';
        scaleBadge.textContent = '100%';
        const zoomInBtn = makeButton('+', wt('xt.k019', 'Увеличить'));
        const fitBtn = makeButton(wt('xt.k020', 'Подогнать'), wt('xt.k021', 'Подогнать к окну'));
        const closeBtn = makeButton(wt('xt.k022', 'Закрыть'), wt('xt.k023', 'Закрыть просмотр'));

        controls.appendChild(zoomOutBtn);
        controls.appendChild(scaleBadge);
        controls.appendChild(zoomInBtn);
        controls.appendChild(fitBtn);
        controls.appendChild(closeBtn);
        topBar.appendChild(title);
        topBar.appendChild(controls);

        const viewport = document.createElement('div');
        viewport.className = 'test-image-bank-viewer__viewport';

        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = caption || wt('xt.k016', 'Изображение');
        img.draggable = false;
        img.className = 'test-image-bank-viewer__image';

        let naturalWidth = 0;
        let naturalHeight = 0;
        let scale = 1;
        let fittedScale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let startTranslateX = 0;
        let startTranslateY = 0;

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const getViewportRect = () => viewport.getBoundingClientRect();
        const computeFittedScale = () => {
            const rect = getViewportRect();
            if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) return 1;
            return Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
        };

        const updateToolbarState = () => {
            scaleBadge.textContent = `${Math.round(scale * 100)}%`;
            zoomOutBtn.disabled = scale <= 0.2;
            zoomInBtn.disabled = scale >= 8;
        };

        const clampTranslation = () => {
            const rect = getViewportRect();
            const renderedWidth = naturalWidth * scale;
            const renderedHeight = naturalHeight * scale;
            if (!rect.width || !rect.height || !renderedWidth || !renderedHeight) return;

            translateX = renderedWidth <= rect.width
                ? (rect.width - renderedWidth) / 2
                : clamp(translateX, rect.width - renderedWidth, 0);
            translateY = renderedHeight <= rect.height
                ? (rect.height - renderedHeight) / 2
                : clamp(translateY, rect.height - renderedHeight, 0);
        };

        const applyTransform = () => {
            clampTranslation();
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            updateToolbarState();
        };

        const fitToViewport = () => {
            if (!naturalWidth || !naturalHeight) return;
            fittedScale = computeFittedScale();
            scale = fittedScale;
            translateX = 0;
            translateY = 0;
            applyTransform();
        };

        const setScaleAroundPoint = (nextScale, pointX, pointY) => {
            if (!naturalWidth || !naturalHeight) return;
            const rect = getViewportRect();
            const localX = pointX - rect.left;
            const localY = pointY - rect.top;
            const clampedScale = clamp(nextScale, 0.2, 8);
            if (clampedScale === scale) return;

            const imageLocalX = (localX - translateX) / scale;
            const imageLocalY = (localY - translateY) / scale;
            scale = clampedScale;
            fittedScale = computeFittedScale();
            translateX = localX - imageLocalX * scale;
            translateY = localY - imageLocalY * scale;
            applyTransform();
        };

        const stepZoom = (multiplier) => {
            const rect = getViewportRect();
            setScaleAroundPoint(scale * multiplier, rect.left + rect.width / 2, rect.top + rect.height / 2);
        };

        const onDragMove = (event) => {
            if (!isDragging) return;
            translateX = startTranslateX + (event.clientX - dragStartX);
            translateY = startTranslateY + (event.clientY - dragStartY);
            applyTransform();
        };

        const onDragEnd = () => {
            isDragging = false;
            img.style.cursor = 'grab';
        };

        const closeViewer = () => {
            window.removeEventListener('mousemove', onDragMove);
            window.removeEventListener('mouseup', onDragEnd);
            window.removeEventListener('resize', fitToViewport);
            window.removeEventListener('keydown', onKeyDown);
            overlay.remove();
        };

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeViewer();
            } else if (event.key === '0') {
                event.preventDefault();
                fitToViewport();
            } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                stepZoom(1.15);
            } else if (event.key === '-' || event.key === '_') {
                event.preventDefault();
                stepZoom(0.85);
            }
        }

        viewport.addEventListener('wheel', (event) => {
            event.preventDefault();
            setScaleAroundPoint(scale * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
        }, { passive: false });

        viewport.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            isDragging = true;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            startTranslateX = translateX;
            startTranslateY = translateY;
            img.style.cursor = 'grabbing';
        });

        viewport.addEventListener('dblclick', (event) => {
            event.preventDefault();
            if (Math.abs(scale - fittedScale) < 0.05) {
                setScaleAroundPoint(Math.max(fittedScale * 2, 1.75), event.clientX, event.clientY);
            } else {
                fitToViewport();
            }
        });

        zoomOutBtn.onclick = () => stepZoom(0.85);
        zoomInBtn.onclick = () => stepZoom(1.15);
        fitBtn.onclick = () => fitToViewport();
        closeBtn.onclick = (event) => {
            event.preventDefault();
            closeViewer();
        };

        overlay.addEventListener('click', closeViewer);
        container.addEventListener('click', (event) => event.stopPropagation());
        img.addEventListener('load', () => {
            naturalWidth = img.naturalWidth || 0;
            naturalHeight = img.naturalHeight || 0;
            fitToViewport();
        });

        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
        window.addEventListener('resize', fitToViewport);
        window.addEventListener('keydown', onKeyDown);

        viewport.appendChild(img);
        container.appendChild(topBar);
        container.appendChild(viewport);
        overlay.appendChild(container);
        document.body.appendChild(overlay);

        if (img.complete) {
            naturalWidth = img.naturalWidth || 0;
            naturalHeight = img.naturalHeight || 0;
            fitToViewport();
        } else {
            updateToolbarState();
        }
        overlay.focus();
    }

    getImageBankContainer() {
        return document.querySelector('.test-editor-sidebar--right .test-image-bank')
            || document.querySelector('.test-image-bank');
    }

    syncImageBankCollapsedState() {
        const bank = this.getImageBankContainer();
        const panel = bank?.querySelector('#test-image-bank-panel');
        const toggle = bank?.querySelector('#test-image-bank-toggle');
        const expanded = Boolean(this.isImageBankExpanded);

        if (bank) bank.classList.toggle('is-expanded', expanded);
        if (panel) panel.classList.toggle('hidden', !expanded);
        if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    toggleImageBankExpanded(force) {
        this.isImageBankExpanded = typeof force === 'boolean'
            ? force
            : !this.isImageBankExpanded;
        this.syncImageBankCollapsedState();
    }

    renderImageBank() {
        const bank = this.getImageBankContainer();
        const grid = bank?.querySelector('#test-image-bank-grid');
        const empty = bank?.querySelector('#test-image-bank-empty');
        const count = bank?.querySelector('#test-image-bank-count');
        const panel = bank?.querySelector('#test-image-bank-panel');
        const toggle = bank?.querySelector('#test-image-bank-toggle');
        if (!grid && !empty && !count && !panel && !toggle) return;
        this.syncImageBankCollapsedState();

        const items = this.collectImageBankItems();
        let selectedKey = this.selectedBankImageItem?.key || "";
        if (selectedKey && !items.some((item) => item.key === selectedKey)) {
            this.selectedBankImageItem = null;
            selectedKey = "";
        }

        if (count) count.textContent = String(items.length);
        if (empty) empty.classList.toggle('hidden', items.length > 0);
        if (!grid) return;

        grid.innerHTML = '';
        grid.classList.toggle('hidden', items.length === 0);

        items.forEach((item) => {
            const src = this.resolveImageSource(item.ref);
            if (!src) return;

            const isSelected = item.key === selectedKey;
            const firstSource = item.sources[0] || wt('xt.k016', 'Изображение');
            const usageLabel = item.usageCount === 1 ? wt('xt.k024', '1 место') : `${item.usageCount}${wt('xt.k024b', ' мест')}`;

            const itemNode = document.createElement('div');
            itemNode.className = `test-image-bank__item${isSelected ? ' is-selected' : ''}`;

            const img = document.createElement('img');
            img.src = src;
            img.alt = firstSource;
            img.loading = 'lazy';

            const selectButton = document.createElement('button');
            selectButton.type = 'button';
            selectButton.className = 'test-image-bank__select';
            selectButton.title = isSelected ? wt('xt.k025', 'Отменить выбор изображения') : `${wt('xt.k025b', 'Выбрать: ')}${firstSource}`;
            selectButton.setAttribute('aria-label', selectButton.title);
            selectButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
            selectButton.onclick = () => {
                this.selectImageBankItem(item);
            };

            const previewButton = document.createElement('button');
            previewButton.type = 'button';
            previewButton.className = 'test-image-bank__preview-btn';
            previewButton.title = wt('xt.k026', 'Открыть изображение');
            previewButton.setAttribute('aria-label', wt('xt.k026', 'Открыть изображение'));
            previewButton.innerHTML = '<span class="material-symbols-outlined text-[15px]">zoom_in</span>';
            previewButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openImageBankViewer(src, firstSource);
            };

            const meta = document.createElement('span');
            meta.className = 'test-image-bank__item-meta';
            meta.textContent = isSelected ? wt('xt.k027', 'Выбрано') : usageLabel;

            selectButton.appendChild(img);
            itemNode.appendChild(selectButton);
            itemNode.appendChild(previewButton);
            itemNode.appendChild(meta);
            grid.appendChild(itemNode);
        });

        if (empty) empty.classList.toggle('hidden', grid.children.length > 0);
        grid.classList.toggle('hidden', grid.children.length === 0);
        this.syncBankImageTargetUI();
    }

    buildQuestionImageRefs(question) {
        if (!question || typeof question !== "object") {
            return [];
        }

        const hasCanonicalImages = Array.isArray(question.images);
        const candidates = hasCanonicalImages ? [...question.images] : [];

        const legacyCandidate = {
            image: question.image,
            image_path: question.image_path,
            image_asset_id: question.image_asset_id,
            asset_id: question.asset_id,
            image_asset_url: question.image_asset_url,
            image_url: question.image_url,
            asset_url: question.asset_url,
        };
        if (!hasCanonicalImages && !candidates.length) {
            candidates.push(legacyCandidate);
        }

        const refs = [];
        const seen = new Set();
        const limit = this.getMaxQuestionImages();

        candidates.forEach((candidate) => {
            if (refs.length >= limit) return;
            const ref = this.serializeImageReference(candidate);
            if (!ref) return;
            const key = this.getImageReferenceKey(ref);
            if (!key || seen.has(key)) return;
            seen.add(key);
            refs.push(ref);
        });

        return refs;
    }

    syncQuestionLegacyImageFields(question) {
        if (!question || typeof question !== "object") {
            return [];
        }
        const refs = this.buildQuestionImageRefs(question);
        question.images = refs;

        const first = refs[0] || null;
        question.image = first?.path || null;
        question.image_path = first?.path || null;
        question.image_asset_id = first?.asset_id || null;
        question.image_asset_url = first?.asset_url || null;
        return refs;
    }

    createEmptyQuestion() {
        return {
            id: Date.now(),
            text: wt('xt.k125', 'Новый вопрос'),
            options: [
                { text: wt('xt.k126', 'Вариант 1'), is_correct: true, image_path: null, image_asset_id: null, image_asset_url: null },
                { text: wt('xt.k127', 'Вариант 2'), is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null }
            ],
            settings: { all_correct_required: true, allow_partial_credit: false },
            explanation: "",
            image: null,
            image_asset_id: null,
            image_asset_url: null,
            images: []
        };
    }

    createTestEditorOnboardingQuestions() {
        const onboardingWaveImageUrl = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20160%2090%22%3E%3Crect%20width%3D%22160%22%20height%3D%2290%22%20rx%3D%2216%22%20fill%3D%22%23eef7ff%22%2F%3E%3Cpath%20d%3D%22M14%2048%20C32%2018%2C50%2018%2C68%2048%20S104%2078%2C122%2048%20S146%2018%2C154%2034%22%20fill%3D%22none%22%20stroke%3D%22%232f63d8%22%20stroke-width%3D%226%22%20stroke-linecap%3D%22round%22%2F%3E%3Cpath%20d%3D%22M38%2068%20H118%22%20stroke%3D%22%230f766e%22%20stroke-width%3D%223%22%20stroke-linecap%3D%22round%22%20stroke-dasharray%3D%226%207%22%2F%3E%3Ccircle%20cx%3D%2238%22%20cy%3D%2248%22%20r%3D%225%22%20fill%3D%22%230f766e%22%2F%3E%3Ccircle%20cx%3D%22118%22%20cy%3D%2248%22%20r%3D%225%22%20fill%3D%22%230f766e%22%2F%3E%3C%2Fsvg%3E';
        return [
            {
                id: 101,
                text: 'Какой параметр электромагнитной волны определяет расстояние между двумя соседними максимумами?',
                options: [
                    { text: 'Длина волны', is_correct: true, image_path: null, image_asset_id: null, image_asset_url: onboardingWaveImageUrl },
                    { text: 'Амплитуда сигнала', is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null },
                    { text: 'Период полураспада', is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null },
                ],
                settings: { all_correct_required: true, allow_partial_credit: false },
                explanation: 'Длина волны измеряет расстояние между соседними точками колебания в одинаковой фазе.',
                image: null,
                image_asset_id: null,
                image_asset_url: null,
                images: [],
            },
            {
                id: 102,
                text: 'Какие утверждения верны для электромагнитных волн?',
                options: [
                    { text: 'Могут распространяться в вакууме', is_correct: true, image_path: null, image_asset_id: null, image_asset_url: null },
                    { text: 'Всегда требуют упругую среду', is_correct: false, image_path: null, image_asset_id: null, image_asset_url: null },
                    { text: 'Переносят энергию', is_correct: true, image_path: null, image_asset_id: null, image_asset_url: null },
                ],
                settings: { all_correct_required: true, allow_partial_credit: false },
                explanation: 'Если отмечено несколько правильных вариантов, тест автоматически становится множественным выбором.',
                image: null,
                image_asset_id: null,
                image_asset_url: null,
                images: [],
            },
        ];
    }

    ensureTestEditorOnboardingPreviewTask() {
        if (!this.testEditorOnboardingPreview) return;

        this.moduleId = this.moduleId || 'onboarding-preview-module';
        this.topicId = this.topicId || 'onboarding-preview-topic';
        this.taskId = this.taskId || 'onboarding-preview-test';
        this.isNewTaskParam = true;
        this.hasPersistedTask = false;
        this.task = {
            task_data: {
                id: this.taskId,
                type: 'test',
                name: 'Тест: параметры волны',
                content: {},
                settings: {},
                meta: {
                    id: this.taskId,
                    module: this.moduleId,
                    topic: this.topicId,
                    name: 'Тест: параметры волны',
                },
            },
            metadata: {
                id: this.taskId,
                module: this.moduleId,
                topic: this.topicId,
                name: 'Тест: параметры волны',
                type: 'test',
            },
        };
    }

    applyTestEditorOnboardingPreviewState() {
        if ((!this.testEditorOnboardingPreview && !this.testEditorOnboardingDemoActive) || !this.task) return;

        this.questions = this.createTestEditorOnboardingQuestions();
        this.currentQuestionIndex = 0;
        if (!this.task.task_data) this.task.task_data = {};
        if (!this.task.task_data.content) this.task.task_data.content = {};
        if (!this.task.task_data.meta) this.task.task_data.meta = {};
        if (!this.task.metadata) this.task.metadata = {};
        this.task.task_data.name = 'Тест: параметры волны';
        this.task.task_data.type = 'test';
        this.task.task_data.meta.name = 'Тест: параметры волны';
        this.task.metadata.name = 'Тест: параметры волны';
        this.task.metadata.type = 'test';
        this.task.task_data.content = {
            ...this.task.task_data.content,
            ...this.buildBackendContent(),
        };
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    resetTestEditorOnboardingPreviewState() {
        if (!this.testEditorOnboardingPreview || !this.task || this.testEditorOnboardingFinished) return;
        this.testEditorOnboardingFinished = true;
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        this.questions = [this.createEmptyQuestion()];
        this.currentQuestionIndex = 0;
        if (!this.task.task_data) this.task.task_data = {};
        this.task.task_data.content = this.buildBackendContent();
        this.renderUI();
        this.initialSnapshot = this.captureSnapshot();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    cloneTestEditorOnboardingValue(value) {
        if (value == null) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    applyTestEditorOnboardingDemoState() {
        if (this.testEditorOnboardingPreview || !this.task) return;
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        if (!this.testEditorOnboardingDemoSnapshot) {
            this.testEditorOnboardingDemoSnapshot = {
                task: this.cloneTestEditorOnboardingValue(this.task),
                questions: this.cloneTestEditorOnboardingValue(this.questions),
                currentQuestionIndex: this.currentQuestionIndex,
                initialSnapshot: this.initialSnapshot,
                hasUnsavedChanges: this.hasUnsavedChanges,
            };
        }
        this.testEditorOnboardingDemoActive = true;
        this.applyTestEditorOnboardingPreviewState();
    }

    restoreTestEditorOnboardingDemoState() {
        const snapshot = this.testEditorOnboardingDemoSnapshot;
        this.testEditorOnboardingDemoSnapshot = null;
        this.testEditorOnboardingDemoActive = false;
        if (!snapshot) return;
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        this.task = this.cloneTestEditorOnboardingValue(snapshot.task);
        this.questions = this.cloneTestEditorOnboardingValue(snapshot.questions) || [];
        this.currentQuestionIndex = Number.isFinite(snapshot.currentQuestionIndex)
            ? snapshot.currentQuestionIndex
            : 0;
        this.renderUI();
        this.initialSnapshot = snapshot.initialSnapshot;
        this.hasUnsavedChanges = Boolean(snapshot.hasUnsavedChanges);
        this.updateSaveStatus();
    }

    getTestEditorOnboardingBranchConfig(kind) {
        return {
            kind: 'import',
            buttonSelector: '[data-onboarding-target="test-editor-import-button"]',
            markerSelector: '.test-editor-onboarding-import-marker',
            markerClass: 'test-editor-onboarding-import-marker',
            activeProp: 'testEditorOnboardingImportVariantActive',
            timerProp: 'testEditorOnboardingImportMarkerTimer',
            datasetKey: 'onboardingImportVariant',
            variant: 'import-tools',
            title: wt('xt.k028', 'Показать обучение по импорту вопросов'),
            calloutTitles: [wt('xt.k029', 'Способ импорта'), wt('xt.k030', 'Проверка данных'), wt('xt.k031', 'Применение к тесту')],
        };
    }

    removeTestEditorOnboardingBranchMarker(kind) {
        const config = this.getTestEditorOnboardingBranchConfig(kind);
        window.clearTimeout(this[config.timerProp]);
        this[config.timerProp] = 0;
        document.querySelectorAll(config.markerSelector).forEach((node) => node.remove());
    }

    removeTestEditorOnboardingBranchMarkers() {
        this.removeTestEditorOnboardingBranchMarker('import');
    }

    positionTestEditorOnboardingBranchMarker(kind) {
        const config = this.getTestEditorOnboardingBranchConfig(kind);
        const marker = document.querySelector(config.markerSelector);
        const button = marker?.__testEditorBranchButton || document.querySelector(config.buttonSelector);
        if (!marker || !button?.isConnected) return false;

        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            marker.classList.remove('is-positioned', 'is-visible');
            return false;
        }

        const markerSize = marker.offsetWidth || 24;
        const margin = 12;
        const left = Math.max(
            margin,
            Math.min(window.innerWidth - markerSize - margin, rect.left + (rect.width - markerSize) / 2)
        );
        const top = Math.max(
            margin,
            Math.min(window.innerHeight - markerSize - margin, rect.bottom + 5)
        );
        marker.style.left = `${left}px`;
        marker.style.top = `${top}px`;
        marker.classList.add('is-positioned');
        return true;
    }

    positionTestEditorOnboardingBranchMarkers() {
        this.positionTestEditorOnboardingBranchMarker('import');
    }

    applyTestEditorOnboardingBranchVariant(kind, attempt = 0) {
        const config = this.getTestEditorOnboardingBranchConfig(kind);
        if (document.body?.dataset?.onboardingStepId !== 'test-editor-question-structure') return;
        const applied = Boolean(
            window.OnboardingTour
            && typeof window.OnboardingTour.setStepVariant === 'function'
            && window.OnboardingTour.setStepVariant(config.variant)
        );
        const hasBranchCallouts = Array.from(document.querySelectorAll('.onboarding-tour-callout-title'))
            .some((node) => config.calloutTitles.includes(node.textContent?.trim()));
        if ((!applied || !hasBranchCallouts) && attempt < 6) {
            window.setTimeout(() => this.applyTestEditorOnboardingBranchVariant(kind, attempt + 1), 120);
        }
    }

    ensureTestEditorOnboardingBranchMarker(kind) {
        const config = this.getTestEditorOnboardingBranchConfig(kind);
        const button = document.querySelector(config.buttonSelector);
        if (!button) return;
        const existing = document.querySelector(config.markerSelector);
        if (existing && existing.__testEditorBranchButton === button) {
            this.positionTestEditorOnboardingBranchMarker(kind);
            return;
        }

        this.removeTestEditorOnboardingBranchMarker(kind);
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = config.markerClass;
        marker.setAttribute('aria-label', config.title);
        marker.setAttribute('title', config.title);
        marker.setAttribute('data-onboarding-interactive', `test-${kind}-marker`);
        marker.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">priority_high</span>';
        marker.__testEditorBranchButton = button;
        marker.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.testEditorOnboardingImportVariantActive = kind === 'import';
            document.body.dataset[config.datasetKey] = config.variant;
            this.removeTestEditorOnboardingBranchMarkers();
            this.resetImportModal();
            this.showImportModal(true);
            this.applyTestEditorOnboardingBranchVariant(kind);
        });
        document.body.appendChild(marker);
        this.positionTestEditorOnboardingBranchMarker(kind);
        window.requestAnimationFrame(() => this.positionTestEditorOnboardingBranchMarker(kind));
        window.requestAnimationFrame(() => {
            if (this.positionTestEditorOnboardingBranchMarker(kind)) {
                marker.classList.add('is-visible');
            }
        });
        window.setTimeout(() => this.positionTestEditorOnboardingBranchMarker(kind), 180);
        window.setTimeout(() => this.positionTestEditorOnboardingBranchMarker(kind), 420);
    }

    scheduleTestEditorOnboardingBranchMarker(kind, delayMs = 260) {
        const config = this.getTestEditorOnboardingBranchConfig(kind);
        window.clearTimeout(this[config.timerProp]);
        this[config.timerProp] = window.setTimeout(() => {
            this[config.timerProp] = 0;
            if (
                document.body?.dataset?.onboardingTourId !== TEST_EDITOR_ONBOARDING_TOUR_ID
                || document.body?.dataset?.onboardingStepId !== 'test-editor-question-structure'
                || this.testEditorOnboardingImportVariantActive
            ) {
                return;
            }
            this.ensureTestEditorOnboardingBranchMarker(kind);
        }, delayMs);
    }

    scheduleTestEditorOnboardingBranchMarkers(delayMs = 260) {
        this.scheduleTestEditorOnboardingBranchMarker('import', delayMs);
    }

    resetTestEditorOnboardingBranchState() {
        this.testEditorOnboardingImportVariantActive = false;
        delete document.body.dataset.onboardingImportVariant;
    }

    syncTestEditorOnboardingInspectorVariant(attempt = 0) {
        if (document.body?.dataset?.onboardingStepId !== 'test-editor-inspector') return;
        if (!window.OnboardingTour || typeof window.OnboardingTour.setStepVariant !== 'function') return;

        const answerTypeCard = document.querySelector('[data-onboarding-target="test-editor-answer-type"]');
        if (!answerTypeCard) {
            if (attempt < 6) {
                window.setTimeout(() => this.syncTestEditorOnboardingInspectorVariant(attempt + 1), 90);
            }
            return;
        }

        const rect = answerTypeCard.getBoundingClientRect();
        const useSideCallout = rect.width <= 520 && rect.left > 520;
        window.OnboardingTour.setStepVariant(useSideCallout ? 'inspector-side' : '');
    }

    prepareTestEditorOnboardingOptionsStep(attempt = 0) {
        if (document.body?.dataset?.onboardingStepId !== 'test-editor-options') return;
        const imageBank = document.querySelector('[data-onboarding-target="test-editor-image-bank"]');
        if (!imageBank) {
            if (attempt < 6) {
                window.setTimeout(() => this.prepareTestEditorOnboardingOptionsStep(attempt + 1), 90);
            }
            return;
        }

        this.toggleImageBankExpanded(true);
        this.renderImageBank();
        const sidebar = imageBank.closest('.test-editor-sidebar--right');
        if (sidebar) {
            const sidebarRect = sidebar.getBoundingClientRect();
            const bankRect = imageBank.getBoundingClientRect();
            const nextTop = Math.max(0, sidebar.scrollTop + bankRect.top - sidebarRect.top - 82);
            sidebar.scrollTo({ top: nextTop, behavior: 'auto' });
        }
        window.requestAnimationFrame(() => {
            window.OnboardingTour?.setStepVariant?.('');
            window.dispatchEvent(new Event('resize'));
        });
    }

    prepareTestEditorOnboardingInspectorStep(attempt = 0) {
        if (document.body?.dataset?.onboardingStepId !== 'test-editor-inspector') return;
        const answerType = document.querySelector('[data-onboarding-target="test-editor-answer-type"]');
        const feedback = document.querySelector('[data-onboarding-target="test-editor-feedback"]');
        if (!answerType || !feedback) {
            if (attempt < 6) {
                window.setTimeout(() => this.prepareTestEditorOnboardingInspectorStep(attempt + 1), 90);
            }
            return;
        }

        this.toggleImageBankExpanded(false);
        const sidebar = answerType.closest('.test-editor-sidebar--right');
        if (sidebar) {
            sidebar.scrollTo({ top: 0, behavior: 'auto' });
        }
        window.requestAnimationFrame(() => {
            this.syncTestEditorOnboardingInspectorVariant();
            window.dispatchEvent(new Event('resize'));
        });
    }

    setupTestEditorOnboardingTourBridge() {
        window.addEventListener('onboarding:before-start', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== TEST_EDITOR_ONBOARDING_TOUR_ID || detail.preview) return;
            this.applyTestEditorOnboardingDemoState();
        });

        window.addEventListener('onboarding:step-ready', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== TEST_EDITOR_ONBOARDING_TOUR_ID) return;
            if (detail.stepId === 'test-editor-question-structure') {
                this.resetTestEditorOnboardingBranchState();
                this.hideImportModal();
                this.scheduleTestEditorOnboardingBranchMarkers();
                return;
            }
            this.removeTestEditorOnboardingBranchMarkers();
            this.hideImportModal();
            if (detail.stepId === 'test-editor-options') {
                window.requestAnimationFrame(() => this.prepareTestEditorOnboardingOptionsStep());
                return;
            }
            if (detail.stepId !== 'test-editor-inspector') return;
            window.requestAnimationFrame(() => this.prepareTestEditorOnboardingInspectorStep());
        });

        window.addEventListener('resize', () => {
            this.positionTestEditorOnboardingBranchMarkers();
            this.syncTestEditorOnboardingInspectorVariant();
        }, { passive: true });

        window.addEventListener('scroll', () => {
            this.positionTestEditorOnboardingBranchMarkers();
        }, { passive: true });

        window.addEventListener('onboarding:finish', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== TEST_EDITOR_ONBOARDING_TOUR_ID) return;
            this.resetTestEditorOnboardingBranchState();
            this.removeTestEditorOnboardingBranchMarkers();
            this.hideImportModal();
            if (!this.testEditorOnboardingPreview) {
                this.restoreTestEditorOnboardingDemoState();
                return;
            }
            this.resetTestEditorOnboardingPreviewState();
        });

        window.addEventListener('onboarding:before-variant-back', (event) => {
            const detail = event?.detail || {};
            if (
                detail.tourId !== TEST_EDITOR_ONBOARDING_TOUR_ID
                || detail.stepId !== 'test-editor-question-structure'
                || detail.variant !== 'import-tools'
            ) {
                return;
            }
            this.resetTestEditorOnboardingBranchState();
            this.hideImportModal();
            this.scheduleTestEditorOnboardingBranchMarkers(420);
        });
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

        const normalizedQuestion = {
            id: Number.isFinite(question.id) ? question.id : fallbackIndex,
            text: question.text ?? "",
            options: options.length ? options : this.createEmptyQuestion().options,
            settings: {
                all_correct_required: question.settings?.all_correct_required !== false,
                allow_partial_credit: Boolean(question.settings?.allow_partial_credit)
            },
            explanation: question.explanation ?? "",
            image: question.image ?? question.image_path ?? null,
            image_path: question.image_path ?? question.image ?? null,
            image_asset_id: question.image_asset_id ?? question.asset_id ?? null,
            image_asset_url: question.image_asset_url ?? question.image_url ?? question.asset_url ?? null,
            images: Array.isArray(question.images) ? [...question.images] : undefined
        };
        this.syncQuestionLegacyImageFields(normalizedQuestion);
        return normalizedQuestion;
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
            const normalizedQuestion = {
                id: Number.isFinite(question?.id) ? question.id : idx,
                text: question?.text ?? "",
                options: this.normalizeAnswersToOptions(question?.answers),
                settings: {
                    all_correct_required: true,
                    allow_partial_credit: false
                },
                explanation: question?.explanation ?? "",
                image: question?.image ?? question?.image_path ?? null,
                image_path: question?.image_path ?? question?.image ?? null,
                image_asset_id: question?.image_asset_id ?? question?.asset_id ?? null,
                image_asset_url: question?.image_asset_url ?? question?.image_url ?? question?.asset_url ?? null,
                images: Array.isArray(question?.images) ? [...question.images] : undefined
            };
            this.syncQuestionLegacyImageFields(normalizedQuestion);
            return normalizedQuestion;
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

            const questionImages = this.syncQuestionLegacyImageFields(question);
            const questionRef = questionImages[0] || null;

            const payload = {
                id: Number.isFinite(question.id) ? question.id : idx,
                text: (question.text ?? "").trim(),
                answers,
                options
            };

            if (questionRef?.path) {
                payload.image = questionRef.path;
                payload.image_path = questionRef.path;
            }
            if (questionRef?.asset_id) {
                payload.image_asset_id = questionRef.asset_id;
            }
            if (questionRef?.asset_url) {
                payload.image_asset_url = questionRef.asset_url;
            }
            if (questionImages.length) {
                payload.images = questionImages.map((ref) => ({ ...ref }));
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
        if (this.testEditorOnboardingPreview) {
            this.ensureTestEditorOnboardingPreviewTask();
        } else {
            await this.initTaskFromUrlContext();
        }
        this.applyTestEditorOnboardingPreviewState();
        this.setupTestEditorOnboardingTourBridge();
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
            return { type: 'unknown', label: wt('xt.k032', 'Нет данных'), tone: 'text-text-disabled' };
        }
        const correctCount = question.options.filter((opt) => opt.is_correct).length;
        if (correctCount === 0) {
            return { type: 'invalid', label: wt('xt.k033', 'Нет правильных ответов'), tone: 'text-error-text' };
        }
        if (correctCount === 1) {
            return { type: 'single_choice', label: wt('xt.k034', 'Одиночный выбор'), tone: 'text-success-text' };
        }
        return { type: 'multiple_choice', label: wt('xt.k035', 'Множественный выбор'), tone: 'text-info-text' };
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
            || wt('xt.k036', 'Новый тест')
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
        let meta = `${filledOptions}/${options.length || 0}${wt('xt.k037', ' вариантов заполнено')}`;

        if (isReady) {
            state = 'ready';
            meta = correctCount > 1
                ? `${correctCount}${wt('xt.k038', ' правильных ответа')}`
                : wt('xt.k039', '1 правильный ответ');
        } else if (isEmpty) {
            state = 'empty';
            meta = wt('xt.k040', 'Заполните вопрос и минимум два варианта');
        } else if (correctCount === 0) {
            meta = wt('xt.k041', 'Отметьте правильный вариант');
        }

        return { state, meta, correctCount, filledOptions };
    }

    updateEditorChrome() {
        const taskName = this.getTaskDisplayName() || wt('xt.k036', 'Новый тест');
        const currentLabel = `${wt('xt.k010', 'Вопрос ')}${this.currentQuestionIndex + 1}${wt('xt.k042', ' из ')}${this.questions.length}`;
        const questionCount = this.questions.length;
        const countLabel = questionCount === 1 ? wt('xt.k043', '1 вопрос') : `${questionCount}${wt('xt.k043b', ' вопросов')}`;

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
        this.renderImageBank();
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
        const removeButtons = document.querySelectorAll('.remove-question-image-btn, .question-media-thumb__remove');
        const isBusy = Boolean(this.isQuestionImageUploading);
        const q = this.questions[this.currentQuestionIndex];
        const imageCount = this.syncQuestionLegacyImageFields(q).length;
        const isAtLimit = imageCount >= this.getMaxQuestionImages();

        if (mediaDock) {
            mediaDock.classList.toggle('is-uploading', isBusy);
            mediaDock.classList.toggle('is-limit', isAtLimit);
        }
        if (uploadBtn) {
            uploadBtn.disabled = isBusy || isAtLimit;
            uploadBtn.classList.toggle('is-busy', isBusy);
            uploadBtn.classList.toggle('is-limit', isAtLimit);
        }
        removeButtons.forEach((removeBtn) => {
            removeBtn.disabled = isBusy;
        });
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
            if (isActive) {
                item.setAttribute('data-onboarding-target', 'test-editor-active-question');
            }

            const questionTitle = (q.text || `${wt('xt.k010', 'Вопрос ')}${index + 1}`).trim();
            const preview = questionTitle.length > 42 ? `${questionTitle.slice(0, 42).trim()}…` : questionTitle || `${wt('xt.k010', 'Вопрос ')}${index + 1}`;
            const safePreview = this.escapeHtml(preview);
            const safeMeta = this.escapeHtml(summary.meta);
            const questionIndex = String(index + 1).padStart(2, '0');
            const deleteDisabled = this.questions.length <= 1;

            item.innerHTML = `
                <button type="button" class="question-nav-item__select" aria-current="${isActive ? 'true' : 'false'}" title="${wt('xt.k044', 'Открыть вопрос ')}${index + 1}">
                    <span class="question-nav-item__index">${questionIndex}</span>
                    <span class="question-nav-item__body">
                        <span class="question-nav-item__title">${safePreview}</span>
                        <span class="question-nav-item__meta">${safeMeta}</span>
                    </span>
                    <span class="question-nav-item__state is-${summary.state}"></span>
                </button>
                <button type="button" class="question-nav-item__delete" title="${wt('xt.k045', 'Удалить вопрос ')}${index + 1}" aria-label="${wt('xt.k045', 'Удалить вопрос ')}${index + 1}" ${deleteDisabled ? 'disabled' : ''}>
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
            this.showToast(wt('xt.k046', 'Вопрос восстановлен'), 'success');
        }
        return true;
    }

    deleteQuestion(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) {
            return;
        }
        if (this.questions.length <= 1) {
            this.showToast(wt('xt.k047', 'Нужен хотя бы один вопрос'), 'warning');
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
        this.showToast(`${wt('xt.k010', 'Вопрос ')}${index + 1}${wt('xt.k048', ' удалён')}`, 'warning', this.questionDeletionUndoMs, {
            toastId,
            actionLabel: wt('xt.k049', 'Отменить'),
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
            textarea.dataset.imagePasteTarget = 'question';
            this.autoResizeQuestionTextarea();
        }

        // Images
        const imageGrid = document.querySelector('#question-images-grid');
        const uploadBtn = document.querySelector('#upload-image-btn');
        const mediaDock = document.querySelector('.question-media-dock');
        const textareaRoot = document.querySelector('#question-textarea');
        const questionSurface = textareaRoot?.closest('section, .question-paste-surface, main');
        const questionImages = this.syncQuestionLegacyImageFields(q);
        const hasQuestionImage = questionImages.length > 0;
        const canAddQuestionImage = questionImages.length < this.getMaxQuestionImages();

        if (questionSurface) {
            questionSurface.classList.add('question-paste-surface');
            questionSurface.dataset.imagePasteTarget = 'question';
        }

        if (imageGrid) {
            imageGrid.innerHTML = '';
            imageGrid.classList.toggle('hidden', !hasQuestionImage);
            imageGrid.setAttribute('aria-hidden', hasQuestionImage ? 'false' : 'true');

            questionImages.forEach((ref, index) => {
                const src = this.resolveImageSource(ref);
                if (!src) return;

                const thumb = document.createElement('div');
                thumb.className = 'question-media-thumb relative overflow-hidden opacity-95 hover:opacity-100 transition';
                thumb.dataset.questionImageIndex = String(index);

                const img = document.createElement('img');
                img.src = src;
                img.alt = `${wt('xt.k050', 'Изображение вопроса ')}${index + 1}`;
                img.className = 'w-full h-full object-cover';

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'remove-question-image-btn question-media-thumb__remove absolute bg-surface-1 border border-border-subtle rounded-full shadow text-text-secondary hover:text-error hover:border-error-light';
                removeBtn.title = `${wt('xt.k051', 'Удалить изображение вопроса ')}${index + 1}`;
                removeBtn.setAttribute('aria-label', `${wt('xt.k051', 'Удалить изображение вопроса ')}${index + 1}`);
                removeBtn.dataset.index = String(index);
                removeBtn.innerHTML = `<span class="material-symbols-outlined text-[16px] leading-none">close</span><span class="question-media-thumb__remove-label">${wt('xt.k052', 'Удалить')}</span>`;
                removeBtn.onclick = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.removeQuestionImage(index);
                };

                thumb.appendChild(img);
                thumb.appendChild(removeBtn);
                imageGrid.appendChild(thumb);
            });
        }

        if (mediaDock) {
            mediaDock.classList.toggle('has-image', hasQuestionImage);
            mediaDock.dataset.imageCount = String(questionImages.length);
        }

        if (textareaRoot) {
            textareaRoot.classList.toggle('has-question-image', hasQuestionImage);
        }

        const questionCard = textareaRoot?.closest('.editor-card--hero, section');
        if (questionCard) {
            questionCard.classList.add('question-paste-card');
            questionCard.dataset.imagePasteTarget = 'question';
        }

        if (uploadBtn) {
            uploadBtn.dataset.imagePasteTarget = 'question';
            const icon = uploadBtn.querySelector('.material-symbols-outlined');
            const label = uploadBtn.querySelector('.question-media-trigger__label');
            uploadBtn.disabled = !canAddQuestionImage || this.isQuestionImageUploading;
            uploadBtn.classList.toggle('is-limit', !canAddQuestionImage);
            if (hasQuestionImage) {
                uploadBtn.classList.remove('hidden');
                uploadBtn.title = canAddQuestionImage
                    ? wt('xt.k053', 'Добавить ещё изображение к вопросу или вставить его через Ctrl+V')
                    : wt('xt.k013', 'К вопросу уже добавлено 3 изображения');
                uploadBtn.setAttribute('aria-label', canAddQuestionImage ? wt('xt.k054', 'Добавить изображение к вопросу') : wt('xt.k055', 'Лимит изображений вопроса достигнут'));
                if (icon) icon.textContent = canAddQuestionImage ? 'add_photo_alternate' : 'photo_library';
                if (label) label.textContent = canAddQuestionImage ? wt('xt.k056', 'Добавить') : wt('xt.k057', 'Лимит');
            } else {
                uploadBtn.classList.remove('hidden');
                uploadBtn.title = wt('xt.k058', 'Добавить изображение к вопросу или вставить его через Ctrl+V');
                uploadBtn.setAttribute('aria-label', wt('xt.k054', 'Добавить изображение к вопросу'));
                if (icon) icon.textContent = 'add_photo_alternate';
                if (label) label.textContent = wt('xt.k059', 'Фото');
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
        this.syncActiveImagePasteTargetUI();
        this.syncBankImageTargetUI();
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
            div.dataset.imagePasteTarget = 'option';
            div.dataset.optionIndex = String(index);
            if (index === 0) {
                div.setAttribute('data-onboarding-target', 'test-editor-first-option');
            }

            const label = String.fromCharCode(65 + index); // A, B, C...
            const optionLabel = `${wt('xt.k060', 'вариант ')}${label}`;
            const statusLabel = opt.is_correct ? wt('xt.k061', 'Правильный') : wt('xt.k062', 'Не выбран');
            const optionImageSrc = this.resolveImageSource(opt.image_path, opt.image_asset_url, opt.image_asset_id);

            div.innerHTML = `
                <button type="button" class="option-letter" ${index === 0 ? 'data-onboarding-target="test-editor-correct-toggle"' : ''} aria-pressed="${opt.is_correct ? 'true' : 'false'}" title="${wt('xt.k063', 'Отметить ')}${optionLabel}${wt('xt.k063b', ' как правильный')}">${label}</button>
                <div class="option-row__main">
                    <div class="option-row__content">
                        <div class="option-row__toolbar">
                            <div class="option-row__toolbar-meta">
                                <span class="option-row__status ${opt.is_correct ? 'is-correct' : ''}">${statusLabel}</span>
                                <span class="option-row__toolbar-label">${wt('xt.k064', 'Ответ')}</span>
                            </div>
                            <div class="option-row__toolbar-actions">
                                <button class="delete-option option-row__delete-btn icon-button-muted border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error transition-all active:scale-95" title="${wt('xt.k065', 'Удалить ')}${optionLabel}" aria-label="${wt('xt.k065', 'Удалить ')}${optionLabel}">
                                    <span class="material-symbols-outlined text-[18px]">delete</span>
                                    ${wt('xt.k052', 'Удалить')}
                                </button>
                            </div>
                        </div>
                        <textarea class="option-row__textarea rounded-md border-border-subtle bg-surface-1 text-sm focus:border-primary focus:ring-primary shadow-sm focus:shadow-md transition-all resize-none"
                            data-image-paste-target="option" data-option-index="${index}"
                            placeholder="${wt('xt.k066', 'Введите текст варианта...')}" rows="1"></textarea>
                    </div>
                    <div class="option-row__media">
                        ${optionImageSrc ? `
                            <div class="option-row__media-frame option-row__media-frame--filled relative">
                                <button class="upload-option-image option-row__media-preview-button"
                                    ${index === 0 ? 'data-onboarding-target="test-editor-first-option-image"' : ''}
                                    data-index="${index}" data-option-index="${index}" data-image-paste-target="option" title="${wt('xt.k067', 'Заменить изображение ')}${optionLabel}${wt('xt.k067b', ' или вставить его через Ctrl+V')}" aria-label="${wt('xt.k067', 'Заменить изображение ')}${optionLabel}">
                                    <span class="option-row__media-preview w-full h-full rounded-lg border border-border-subtle shadow overflow-hidden bg-surface-1">
                                        <img src="${optionImageSrc}" alt="${wt('xt.k068', 'Изображение ')}${optionLabel}"
                                            class="w-full h-full object-cover" />
                                    </span>
                                    <span class="option-row__media-preview-caption">${wt('xt.k069', 'Заменить')}</span>
                                </button>
                                <button class="remove-option-image option-row__media-chip border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error transition shadow-sm"
                                    data-index="${index}" title="${wt('xt.k070', 'Удалить изображение ')}${optionLabel}" aria-label="${wt('xt.k070', 'Удалить изображение ')}${optionLabel}">
                                    <span class="material-symbols-outlined text-[14px] leading-none">close</span>
                                    <span class="option-row__media-chip-label">${wt('xt.k071', 'Убрать')}</span>
                                </button>
                            </div>
                        ` : `
                            <button class="upload-option-image option-row__media-empty-button"
                                    ${index === 0 ? 'data-onboarding-target="test-editor-first-option-image"' : ''}
                                    data-index="${index}" data-option-index="${index}" data-image-paste-target="option" title="${wt('xt.k072', 'Добавить изображение к ')}${optionLabel}${wt('xt.k072b', ' или вставить его через Ctrl+V')}" aria-label="${wt('xt.k072', 'Добавить изображение к ')}${optionLabel}">
                                <span class="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                                <span class="option-row__media-empty-copy">
                                    <span class="option-row__media-empty-title">${wt('xt.k056', 'Добавить')}</span>
                                    <span class="option-row__media-empty-subtitle">${wt('xt.k073', 'изображение')}</span>
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
                    statusNode.textContent = q.options[index].is_correct ? wt('xt.k061', 'Правильный') : wt('xt.k062', 'Не выбран');
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
        this.syncActiveImagePasteTargetUI();
        this.syncBankImageTargetUI();
        this.renderImageBank();
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
        // Task Name Rename Trigger in Header
        const taskNameCaption = document.querySelector('#task-name-caption');
        if (taskNameCaption) {
            this.setupHeaderRenameTrigger(taskNameCaption, {
                onSuccess: () => this.updateEditorChrome()
            });
        }

        // Back
        const backBtn = document.querySelector('header button');
        if (backBtn) backBtn.onclick = () => this.goBack();

        // Add Question
        const addQBtn = document.querySelector('#add-question-btn');
        if (addQBtn) addQBtn.onclick = () => this.addQuestion();

        // Add Option
        const addOptBtn = document.querySelector('#add-option-btn');
        if (addOptBtn) addOptBtn.onclick = () => this.addOption();

        const imageBankToggle = document.querySelector('#test-image-bank-toggle');
        if (imageBankToggle) {
            imageBankToggle.onclick = () => this.toggleImageBankExpanded();
        }

        // Image Upload
        const uploadBtn = document.querySelector('#upload-image-btn');
        const fileInput = document.querySelector('#image-upload-input');
        if (uploadBtn && fileInput) {
            fileInput.multiple = true;
            uploadBtn.onclick = () => {
                const q = this.questions[this.currentQuestionIndex];
                if (this.syncQuestionLegacyImageFields(q).length >= this.getMaxQuestionImages()) {
                    this.showToast(wt('xt.k001', 'Можно добавить не больше 3 изображений к вопросу'), 'warning');
                    return;
                }
                fileInput.click();
            };
            fileInput.onchange = (e) => this.handleImageUpload(e);
        }

        const optionImageInput = document.querySelector('#option-image-input');
        if (optionImageInput) {
            optionImageInput.onchange = (e) => this.handleOptionImageUpload(e);
        }

        document.addEventListener('focusin', (e) => this.handleGlobalFocusIn(e));
        document.addEventListener('paste', (e) => {
            this.handleClipboardPaste(e).catch((error) => {
                console.error('Clipboard image paste failed', error);
                this.showToast(error.message || wt('xt.k074', 'Не удалось вставить изображение'), 'error');
            });
        });

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
        const importTextInput = document.querySelector('#import-text-input');
        const parseImportTextBtn = document.querySelector('#parse-import-text-btn');
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
        if (importTextInput) {
            importTextInput.addEventListener('input', () => this.handleImportTextChanged());
        }
        if (parseImportTextBtn) {
            parseImportTextBtn.onclick = () => this.handleImportTextSubmitted();
        }

        this.importPreview = document.querySelector('#import-question-preview');
        this.importErrorBox = document.querySelector('#import-error');
        this.importWarningBox = document.querySelector('#import-warning');
        this.importParserStatus = document.querySelector('#import-parser-status');
        this.importModal = document.querySelector('#import-modal');
        this.importTextInput = importTextInput;
        this.importTextCount = document.querySelector('#import-text-count');
        this.importSourceOptions = document.querySelectorAll('.import-source-option');
        this.importSourceRadios = document.querySelectorAll('input[name="import-source"]');
        this.importSourcePanels = document.querySelectorAll('[data-import-source-panel]');
        this.chooseImportBtn = chooseImportBtn;
        this.importModeOptions = document.querySelectorAll('.import-mode-option');
        this.importModeRadios = document.querySelectorAll('input[name="import-mode"]');
        this.pasteImageTargetModal = document.querySelector('#paste-image-target-modal');
        this.pasteImageTargetDescription = document.querySelector('#paste-image-target-description');

        const importClose = document.querySelector('#import-modal-close');
        const importCancel = document.querySelector('#cancel-import-btn');
        const importConfirm = document.querySelector('#confirm-import-btn');
        if (importClose) importClose.onclick = () => this.hideImportModal();
        if (importCancel) importCancel.onclick = () => this.hideImportModal(true);
        if (importConfirm) importConfirm.onclick = () => this.confirmImport();
        if (this.importSourceOptions.length) {
            this.importSourceOptions.forEach((option) => {
                option.onclick = () => {
                    const input = option.querySelector('input[type="radio"]');
                    if (!input) return;
                    this.importSource = input.value;
                    this.clearPendingImportParse();
                    this.updateImportSourceUI();
                };
            });
        }
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
        const pasteTargetClose = document.querySelector('#paste-image-target-close');
        const pasteTargetCancel = document.querySelector('#paste-image-target-cancel');
        if (pasteTargetClose) {
            pasteTargetClose.onclick = () => this.hidePasteImageTargetModal(true);
        }
        if (pasteTargetCancel) {
            pasteTargetCancel.onclick = () => this.hidePasteImageTargetModal(true);
        }
        if (this.pasteImageTargetModal) {
            this.pasteImageTargetModal.onclick = (event) => {
                if (event.target === this.pasteImageTargetModal) return;
            };
        }
        document.addEventListener('click', (e) => {
            this.handlePasteTargetSelectionClick(e).catch((error) => {
                console.error('Paste target selection failed', error);
                this.showToast(error.message || wt('xt.k074', 'Не удалось вставить изображение'), 'error');
            });
        }, true);
        document.addEventListener('keydown', (e) => this.handlePasteTargetSelectionKeydown(e), true);
        document.addEventListener('click', (e) => this.handleBankImageTargetSelectionClick(e), true);
        document.addEventListener('keydown', (e) => this.handleBankImageTargetSelectionKeydown(e), true);
        this.updateImportSourceUI();
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
            await this.withLoading(wt('xt.k075', 'Экспорт теста...'), async () => {
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
                    throw new Error(errDetail || wt('xt.k076', 'Экспорт не удался'));
                }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${this.task?.metadata?.id || 'test'}.txt`;
                a.click();
                URL.revokeObjectURL(url);
                this.showToast(wt('xt.k077', 'Файл с вопросами экспортирован'), 'success');
            });
        } catch (error) {
            this.showToast(error.message || wt('xt.k078', 'Ошибка экспорта'), 'error');
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

        this.withLoading(wt('xt.k079', 'Проверка файла...'), async () => {
            try {
                const data = await this.requestJson('/api/editor/test/import', {
                    method: 'POST',
                    body: formData
                });
                const importedQuestions = data.content?.questions || [];
                this.applyImportParseResult(importedQuestions, data.errors || []);
            } catch (error) {
                this.clearPendingImportParse();
                this.pendingImportErrors = [error.message || wt('xt.k080', 'Не удалось прочитать файл')];
                this.showToast(error.message || wt('xt.k080', 'Не удалось прочитать файл'), 'error');
                this.showImportError(this.pendingImportErrors[0]);
            }
        }).finally(() => {
            event.target.value = '';
        });
    }

    handleImportTextChanged() {
        const rawText = this.importTextInput?.value || '';
        if (this.importTextCount) {
            this.importTextCount.textContent = `${rawText.length}${wt('xt.k081', ' символов')}`;
        }
        this.clearPendingImportParse({
            status: rawText.trim() ? wt('xt.k082', 'Текст изменён, разберите снова') : wt('xt.k083', 'Текст ещё не введён'),
        });
    }

    async handleImportTextSubmitted() {
        const rawText = this.importTextInput?.value || '';
        if (!rawText.trim()) {
            this.clearPendingImportParse({ status: wt('xt.k083', 'Текст ещё не введён') });
            this.showImportError(wt('xt.k084', 'Вставьте текст с вопросами'));
            this.setImportConfirmEnabled(false);
            return;
        }

        await this.withLoading(wt('xt.k085', 'Проверка текста...'), async () => {
            try {
                const data = await this.requestJson('/api/editor/test/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: rawText }),
                });
                const importedQuestions = data.content?.questions || [];
                this.pendingImportFile = null;
                this.applyImportParseResult(importedQuestions, data.errors || []);
            } catch (error) {
                this.clearPendingImportParse();
                this.pendingImportErrors = [error.message || wt('xt.k086', 'Не удалось разобрать текст')];
                this.showToast(error.message || wt('xt.k086', 'Не удалось разобрать текст'), 'error');
                this.showImportError(this.pendingImportErrors[0]);
            }
        });
    }

    applyImportParseResult(importedQuestions, errors = []) {
        const questionCountEl = document.querySelector('#import-question-count');
        const warningEl = this.importWarningBox;
        this.pendingImportData = Array.isArray(importedQuestions) ? importedQuestions : [];
        this.pendingImportErrors = Array.isArray(errors) ? errors : [];
        if (questionCountEl) {
            questionCountEl.textContent = this.pendingImportData.length.toString();
        }
        if (warningEl) {
            warningEl.classList.toggle('hidden', this.pendingImportData.length > 0);
        }
        this.renderImportPreview(this.pendingImportData);
        this.showImportError(this.pendingImportErrors[0]);
        this.setImportConfirmEnabled(this.pendingImportData.length > 0 && !this.pendingImportErrors.length);
    }

    clearPendingImportParse({ status = null } = {}) {
        const questionCountEl = document.querySelector('#import-question-count');
        const fileNameEl = document.querySelector('#import-file-name');
        if (fileNameEl) fileNameEl.textContent = '—';
        if (questionCountEl) questionCountEl.textContent = '0';
        if (this.importWarningBox) this.importWarningBox.classList.add('hidden');
        this.pendingImportData = null;
        this.pendingImportFile = null;
        this.pendingImportErrors = [];
        this.renderImportPreview([]);
        this.showImportError('');
        this.setImportConfirmEnabled(false);
        if (status) {
            this.setImportParserStatus(status, 'muted');
        }
    }

    confirmImport() {
        if (!this.pendingImportData || !this.pendingImportData.length) {
            this.showToast(
                this.importSource === 'text'
                    ? wt('xt.k087', 'Сначала разберите текст с вопросами')
                    : wt('xt.k088', 'Сначала выберите корректный файл'),
                'warning'
            );
            return;
        }
        const normalized = this.deserializeQuestions(this.pendingImportData);
        const importedCount = normalized.length;
        if (this.importMode === 'append') {
            const q = this.questions || [];
            this.questions = q.concat(normalized);
        } else {
            this.questions = normalized.length ? normalized : [this.createEmptyQuestion()];
            this.currentQuestionIndex = 0;
        }
        this.renderUI();
        this.markUnsavedChanges();
        this.showToast(`${wt('xt.k089', 'Импортировано ')}${importedCount}${wt('xt.k089b', ' вопросов')}`, 'success');
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
        if (questionCountEl) questionCountEl.textContent = '0';
        if (warningEl) warningEl.classList.add('hidden');
        this.setImportConfirmEnabled(false);
        this.pendingImportData = null;
        this.pendingImportFile = null;
        this.pendingImportErrors = [];
        this.importSource = 'file';
        if (this.importTextInput) this.importTextInput.value = '';
        if (this.importTextCount) this.importTextCount.textContent = wt('xt.k090', '0 символов');
        this.renderImportPreview([]);
        this.showImportError('');
        this.setImportParserStatus(wt('xt.k091', 'Файл ещё не выбран'), 'muted');
        this.importMode = 'append';
        this.updateImportSourceUI();
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
        const modal = this.importModal || document.querySelector('#import-modal');
        if (!modal) return;
        if (show) {
            modal.dataset.importSource = this.importSource;
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

    updateImportSourceUI() {
        if (this.importModal) {
            this.importModal.dataset.importSource = this.importSource;
        }

        if (this.importSourceOptions?.length) {
            this.importSourceOptions.forEach((option) => {
                const input = option.querySelector('input[type="radio"]');
                if (!input) return;
                const isActive = input.value === this.importSource;
                option.dataset.active = isActive;
                if (isActive) {
                    input.checked = true;
                }
            });
        }

        if (this.importSourcePanels?.length) {
            this.importSourcePanels.forEach((panel) => {
                const isActive = panel.dataset.importSourcePanel === this.importSource;
                panel.classList.toggle('hidden', !isActive);
            });
        }

        if (this.chooseImportBtn) {
            this.chooseImportBtn.classList.toggle('hidden', this.importSource !== 'file');
        }

        if (this.importParserStatus && !this.pendingImportData?.length && !this.pendingImportErrors.length) {
            this.setImportParserStatus(
                this.importSource === 'text' ? wt('xt.k083', 'Текст ещё не введён') : wt('xt.k091', 'Файл ещё не выбран'),
                'muted'
            );
        }
        this.renderImportPreview([]);
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
                    ? wt('xt.k092', 'Новые вопросы будут добавлены после существующих.')
                    : wt('xt.k093', 'Текущие вопросы будут заменены импортированными данными.');
        }
    }

    renderImportPreview(questions) {
        if (!this.importPreview) return;
        this.importPreview.innerHTML = '';
        if (!questions || !questions.length) {
            const empty = document.createElement('p');
            empty.className = 'p-3 text-text-muted';
            empty.textContent = this.importSource === 'text'
                ? wt('xt.k094', 'Текст ещё не разобран или не содержит вопросов')
                : wt('xt.k095', 'Файл ещё не выбран или не содержит вопросов');
            this.importPreview.appendChild(empty);
            return;
        }
        questions.slice(0, 10).forEach((q, idx) => {
            const item = document.createElement('div');
            item.className = 'p-3 flex flex-col gap-1 bg-surface-1';
            const title = document.createElement('div');
            title.className = 'text-xs font-semibold text-text-main';
            title.textContent = `${wt('xt.k010', 'Вопрос ')}${idx + 1}`;
            const text = document.createElement('div');
            text.className = 'text-xs text-text-secondary line-clamp-2';
            text.textContent = (q.text || '').trim() || '—';
            const answersInfo = document.createElement('div');
            answersInfo.className = 'text-[11px] text-text-muted';
            const answers = Array.isArray(q.answers) ? q.answers.length : 0;
            const correct = q.answers?.filter?.((a) => a.correct).length || 0;
            answersInfo.textContent = `${answers}${wt('xt.k096', ' вариантов, правильных: ')}${correct}`;
            item.appendChild(title);
            item.appendChild(text);
            item.appendChild(answersInfo);
            this.importPreview.appendChild(item);
        });
        if (questions.length > 10) {
            const more = document.createElement('div');
            more.className = 'p-2 text-[11px] text-center text-text-muted bg-surface-1 border-t border-border-subtle';
            more.textContent = `${wt('xt.k097', '…и ещё ')}${questions.length - 10}`;
            this.importPreview.appendChild(more);
        }
    }

    showImportError(message) {
        if (!this.importErrorBox) return;
        if (message) {
            this.setImportParserStatus(wt('xt.k098', 'Обнаружены ошибки при разборе'), 'error');
        } else if (this.pendingImportData && this.pendingImportData.length) {
            this.setImportParserStatus(wt('xt.k099', 'Парсер отработал без ошибок'), 'success');
        } else {
            this.setImportParserStatus(
                this.importSource === 'text' ? wt('xt.k094b', 'Текст ещё не разобран') : wt('xt.k091', 'Файл ещё не выбран'),
                'muted'
            );
        }
        if (message) {
            this.importErrorBox.textContent = message;
            this.importErrorBox.classList.remove('hidden');
        } else {
            this.importErrorBox.textContent = '';
            this.importErrorBox.classList.add('hidden');
        }
    }

    setImportParserStatus(message, tone = 'muted') {
        if (!this.importParserStatus) return;
        this.importParserStatus.textContent = message;
        this.importParserStatus.classList.remove(
            'bg-bg-secondary',
            'bg-surface-2',
            'text-text-secondary',
            'bg-success-lighter',
            'text-success',
            'text-success-text',
            'bg-error-lighter',
            'text-error',
            'text-error-text'
        );
        if (tone === 'success') {
            this.importParserStatus.classList.add('bg-success-lighter', 'text-success');
        } else if (tone === 'error') {
            this.importParserStatus.classList.add('bg-error-lighter', 'text-error-text');
        } else {
            this.importParserStatus.classList.add('bg-surface-2', 'text-text-secondary');
        }
    }

    async handleImageUpload(event) {
        const input = event?.target;
        const files = Array.from(input?.files || []);
        if (!files.length) return;
        if (input) input.value = '';

        const q = this.questions[this.currentQuestionIndex];
        const remaining = this.getMaxQuestionImages() - this.syncQuestionLegacyImageFields(q).length;
        if (remaining <= 0) {
            this.showToast(wt('xt.k001', 'Можно добавить не больше 3 изображений к вопросу'), 'warning');
            return;
        }

        if (files.length > remaining) {
            this.showToast(`${wt('xt.k100', 'Будут добавлены первые ')}${remaining}${wt('xt.k100b', ' изображ. из выбранных')}`, 'warning');
        }

        for (const file of files.slice(0, remaining)) {
            await this.uploadImageFileForQuestion(file);
        }
    }

    removeQuestionImage(index) {
        const q = this.questions[this.currentQuestionIndex];
        const refs = this.syncQuestionLegacyImageFields(q);
        if (!q || !refs[index]) return;
        q.images = refs.filter((_, refIndex) => refIndex !== index);
        this.syncQuestionLegacyImageFields(q);
        this.renderCurrentQuestion();
        this.renderQuestionList();
        this.showToast(wt('xt.k101', 'Изображение удалено'), 'info');
        this.markUnsavedChanges();
    }

    clearQuestionImage() {
        const q = this.questions[this.currentQuestionIndex];
        const refs = this.syncQuestionLegacyImageFields(q);
        if (!q || !refs.length) return;
        q.images = [];
        this.syncQuestionLegacyImageFields(q);
        this.renderCurrentQuestion();
        this.renderQuestionList();
        this.showToast(wt('xt.k102', 'Изображения удалены'), 'info');
        this.markUnsavedChanges();
    }

    async handleOptionImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (this.pendingOptionImageIndex === null) return;
        const targetIndex = this.pendingOptionImageIndex;

        try {
            await this.uploadImageFileForOption(file, targetIndex);
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
            this.showToast(wt('xt.k047', 'Нужен хотя бы один вопрос'), 'warning');
            return wt('xt.k047', 'Нужен хотя бы один вопрос');
        }

        // Validate each question
        for (let i = 0; i < this.questions.length; i++) {
            const q = this.questions[i];

            // Check question text
            if (!q.text || !q.text.trim()) {
                this.showToast(`${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k103', ': пустой текст')}`, 'warning');
                this.currentQuestionIndex = i;
                this.renderUI();
                return `${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k103', ': пустой текст')}`;
            }

            // Check minimum options
            if (!q.options || q.options.length < 2) {
                this.showToast(`${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k104', ': минимум два варианта ответа')}`, 'warning');
                this.currentQuestionIndex = i;
                this.renderUI();
                return `${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k104', ': минимум два варианта ответа')}`;
            }

            // Check option texts and correct answers
            let hasCorrect = false;
            for (let j = 0; j < q.options.length; j++) {
                const opt = q.options[j];
                // Allow empty text if image is present
                if ((!opt.text || !opt.text.trim()) && !opt.image_path && !opt.image_asset_id && !opt.image_asset_url) {
                    this.currentQuestionIndex = i;
                    this.renderUI();
                    return `${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k011', ', вариант ')}${j + 1}${wt('xt.k103', ': пустой текст')}`;
                }
                if (opt.is_correct) hasCorrect = true;
            }

            // Check for at least one correct answer
            if (!hasCorrect) {
                this.currentQuestionIndex = i;
                this.renderUI();
                return `${wt('xt.k010', 'Вопрос ')}${i + 1}${wt('xt.k105', ': отметьте правильный ответ')}`;
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
            undoBtn.title = wt('xt.k106', 'Отменить удаление вопроса (Ctrl+Z)');
        }
    }

    async confirmAction({
        title,
        message,
        confirmText = wt('xt.k107', 'Подтвердить'),
        cancelText = wt('xt.k108', 'Отмена'),
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
            title: wt('xt.k109', 'Очистить тест?'),
            message: wt('xt.k110', 'Все вопросы будут удалены. Это действие можно отменить только до сохранения.'),
            confirmText: wt('xt.k111', 'Очистить'),
            cancelText: wt('xt.k108', 'Отмена'),
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
        this.showToast(wt('xt.k112', 'Тест очищен'), 'info');
    }

    async deleteTest() {
        this.finalizePendingQuestionDeletion({ dismissToast: true, silent: true });
        if (!this.task) return;
        const deleteConfirmed = await this.confirmAction({
            title: wt('xt.k113', 'Удалить задание?'),
            message: wt('xt.k114', 'Это действие необратимо. Задание будет удалено целиком.'),
            confirmText: wt('xt.k052', 'Удалить'),
            cancelText: wt('xt.k108', 'Отмена'),
            variant: 'error'
        });
        if (!deleteConfirmed) {
            return;
        }

        if (!this.hasPersistedTask) {
            this.discardLocalTaskDraft({ successMessage: wt('xt.k116', 'Черновик удалён') });
            return;
        }

        try {
            await this.withLoading(wt('xt.k117', 'Удаление задания...'), async () => {
                const m = this.task.task_data.meta.module;
                const t = this.task.task_data.meta.topic;
                const id = this.task.metadata.id;

                const response = await fetch(`/api/editor/task/${encodeURIComponent(m)}/${encodeURIComponent(t)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || wt('xt.k118', 'Не удалось удалить задание'));
                }
                this.showToast(wt('xt.k119', 'Задание удалено'), 'success');
                const targetUrl = typeof this.getDashboardReturnUrl === 'function' ? this.getDashboardReturnUrl() : '/editor';
                if (typeof window.navigateWithTransition === 'function') {
                    window.navigateWithTransition(targetUrl);
                } else {
                    window.location.href = targetUrl;
                }
            });
        } catch (err) {
            this.showToast(err.message || wt('xt.k120', 'Ошибка удаления задания'), 'error');
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
            timer.textContent = `${Math.max(1, Math.ceil(options.timerSeconds))}${wt('xt.k121', 'с')}`;
            toast.appendChild(timer);

            let secondsLeft = Math.max(1, Math.ceil(options.timerSeconds));
            toast.__countdownInterval = setInterval(() => {
                secondsLeft -= 1;
                if (!toast.isConnected || secondsLeft <= 0) {
                    clearInterval(toast.__countdownInterval);
                    return;
                }
                timer.textContent = `${secondsLeft}${wt('xt.k121', 'с')}`;
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

    toggleLoading(show, message = wt('xt.k122', 'Загрузка...')) {
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
        if (response.status === 413) {
            throw new Error(wt("editor_base.error_request_too_large", "Размер файла слишком велик. Пожалуйста, выберите файл меньшего размера."));
        }
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (err) {
                throw new Error(wt('xt.k123', 'Некорректный ответ сервера'));
            }
        }
        if (!response.ok) {
            throw new Error(data?.error || response.statusText || wt('xt.k124', 'Ошибка запроса'));
        }
        if (data && Object.prototype.hasOwnProperty.call(data, 'ok') && data.ok === false) {
            throw new Error(data.error || wt('xt.k124', 'Ошибка запроса'));
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
