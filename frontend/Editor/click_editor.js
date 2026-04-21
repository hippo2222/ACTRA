/**
 * ACTRA Click Task Editor
 */

const CLICK_EDITOR_HELPERS =
    (typeof window !== "undefined" && window.ClickEditorHelpers) ||
    (typeof globalThis !== "undefined" && globalThis.ClickEditorHelpers) ||
    null;

const LABEL_DISPLAY_MODES = ["compact", "off"];

const DEFAULT_PROMPT = "Отметьте ошибки в тексте";
// В режиме «Тексты» пользователь выбирает правильный текст (один вариант), поэтому даём отдельный дефолт
const DEFAULT_CHOICE_PROMPT = "Выберите правильный вариант текста";

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

class ClickEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task, this.moduleId, this.topicId, this.taskId, this.hasUnsavedChanges
        // are now inherited from BaseEditor

        // Click Editor specific fields
        // this.task = null; // Now inherited from BaseEditor
        this.taskType = "click";
        this.isDrawTask = false;
        this.annotations = [];
        this.selectedAnnotationIndex = -1;
        this.selectedVertex = null;
        this.draggingVertex = null;
        this.vertexDragMoved = false;

        this.drawingPolygon = false;
        this.currentPolygonPoints = [];
        this.imageMetrics = {
            naturalWidth: 0,
            naturalHeight: 0,
            displayWidth: 0,
            displayHeight: 0,
            left: 0,
            top: 0
        };

        this.palette = this.initAnnotationPalette();

        this.currentTool = "polygon";
        this.toolToggleButtons = [];
        this.drawingFreehand = false;
        this.freehandPoints = [];
        this.isMiddlePanning = false;
        this.middlePanStart = null;
        this.suppressNextClick = false;
        this.isFreehandMouseDown = false;
        this.additionalInfo = { type: "none", text: "", images: [] };
        this.additionalInfoDirty = false;
        this.maxAdditionalImages = 3;
        this.labelMeasureCanvas = null;
        this.labelMeasureCtx = null;
        this.helpers = CLICK_EDITOR_HELPERS;
        this.labelDisplayMode = this.loadLabelDisplayMode();
        this.showHiddenAnnotations = true;
        this.promptToggleBtn = null;
        this.promptAreaWrapper = null;
        this.promptToggleInitialized = false;
        this.choicePromptToggleBtn = null;
        this.choicePromptAreaWrapper = null;
        this.choicePromptToggleInitialized = false;
        this.choicePromptTextarea = null;
        this.additionalInfoToggleBtn = null;
        this.additionalInfoContent = null;
        this.additionalInfoToggleIcon = null;
        this.additionalInfoToggleInitialized = false;
        this.additionalInfoSectionOpen = true;

        this.initialTaskSnapshot = null;
        // this.hasUnsavedChanges = false; // Now inherited from BaseEditor
        this.isNewTaskParam = false;
        this.currentMode = "text";
        this.errorsPaneLoaded = false;
        this.currentSubtaskMode = "text";
        this.errorDetection = {
            enabled: false,
            mode: "text_errors",
            text: "",
            errorSpans: [],
            options: [],
            requiredCorrect: 1,
            requiredCorrectManual: false
        };
        this.subtaskToggleInitialized = false;
        this.errorsPaneInitialized = false;
        this.errorsTextSelection = null;
        this.choiceOptionsIdCounter = 0;
        this.errorsRequiredCorrectInput = null;
        this.errorsRequiredCorrectInputListenerAttached = false;
        this.errorsHighlightLayer = null;
        this.errorsRequiredCurrentLabel = null;

        this.referenceData = {
            text: "",
            spans: []
        };
        this.referenceSelection = null;
        this.referencePaneInitialized = false;
        this.referenceCharLimit = 4000;
        this.referenceHighlightLayer = null;

        this.currentTextPane = "primary";
        this.textPaneToggleButtons = [];
        this.textPanes = [];

        this.zoomLevel = 1;
        this.minZoom = 0.4;
        this.maxZoom = 3;
        this.zoomStep = 0.2;
        this.panX = 0;
        this.panY = 0;
        this.initialPanX = null;
        this.initialPanY = null;
        this.baseImageWidth = 0;
        this.baseImageHeight = 0;
        this.hasCenteredImage = false;
        this.displayImageWidth = 0;
        this.displayImageHeight = 0;
        this.annotationHighlights = new Map();
        this.highlightTimers = new Map();
        this.statusBadgeTimer = null;
        this.toastHideTimer = null;
        this.toastDismissCallback = null;
        this.pendingDeletedAnnotationUndo = null;
        this.toolbarTooltipEl = null;
        this.toolbarTooltipTimer = null;
        this.toolbarTooltipTarget = null;
        this.toolbarTooltipDismissBound = false;

        // Additional info (legacy placeholder)
        this.additionalInfo = { type: "none", text: "", images: [] };
        this.additionalInfoDirty = false;

        this.debugLogBuffer = [];

        this.cacheDom();
        this.setupEventListeners();
        this.init().catch(err => {
            console.error("Critical initialization error:", err);
            this.showFatalError("Ошибка инициализации редактора: " + err.message);
        });
    }

    getDifficultyAuthoringMountPoint() {
        return document.querySelector('aside .p-5.flex.flex-col.gap-4')
            || document.querySelector('aside .p-6.flex.flex-col.gap-8');
    }

    getDifficultyAuthoringLayoutVariant() {
        return 'sidebar-compact';
    }

    getDifficultyAuthoringInsertMode() {
        return 'append';
    }

    initAnnotationPalette() {
        const defaultPalette = [
            "#2563eb", "#ea580c", "#059669", "#9333ea", "#be123c",
            "#0f766e", "#b45309", "#6b21a8", "#1d4ed8", "#14b8a6"
        ];

        const rootStyles = getComputedStyle(document.documentElement);
        const palette = [];

        for (let i = 1; i <= 10; i++) {
            const color = rootStyles.getPropertyValue(`--annotation-color-${i}`).trim();
            palette.push(color || defaultPalette[i - 1]);
        }

        return palette;
    }

    pickColor(index) {
        if (!this.palette || !this.palette.length) return "#3b82f6";
        return this.palette[index % this.palette.length];
    }

    normalizeImageReference(raw) {
        if (!raw && raw !== 0) return null;

        if (typeof raw === "string") {
            const value = raw.trim();
            if (!value) return null;
            if (value.startsWith("/api/assets/") || /^(https?:|data:)/i.test(value)) {
                return { path: null, asset_id: null, asset_url: value };
            }
            return { path: value, asset_id: null, asset_url: null };
        }

        if (typeof raw !== "object") return null;

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
        const asset_id = String(
            raw.asset_id ??
            raw.image_asset_id ??
            nested?.asset_id ??
            nested?.image_asset_id ??
            ""
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
            ""
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

    resolveLocalImagePreviewSrc(raw) {
        const normalized = this.normalizeImageReference(raw);
        if (!normalized) return "";
        if (normalized.asset_url) return normalized.asset_url;
        if (normalized.asset_id) {
            return `/api/assets/${encodeURIComponent(normalized.asset_id)}/content`;
        }
        const path = normalized.path || "";
        if (!path) return "";
        if (/^(https?:|data:)/i.test(path) || path.startsWith("/")) return path;
        return `/api/local-image?path=${encodeURIComponent(path)}`;
    }

    resolveEditorImagePreviewSrc(raw) {
        const normalized = this.normalizeImageReference(raw);
        if (!normalized) return "";
        if (normalized.asset_url) return normalized.asset_url;
        if (normalized.asset_id) {
            return `/api/editor/image?asset_id=${encodeURIComponent(normalized.asset_id)}`;
        }
        const path = normalized.path || "";
        if (!path) return "";
        if (/^(https?:|data:)/i.test(path) || path.startsWith("/api/")) return path;
        if (path.startsWith("/")) return path;
        const params = new URLSearchParams();
        params.set("path", path);
        if (this.moduleId) params.set("module", this.moduleId);
        if (this.topicId) params.set("topic", this.topicId);
        if (this.taskId) params.set("task", this.taskId);
        return `/api/editor/image?${params.toString()}`;
    }

    // ---------------------------------------------------------------------
    // Additional info helpers
    // ---------------------------------------------------------------------
    normalizeAdditionalInfo(raw, options = {}) {
        const { preserveEmptyType = false } = options;
        const empty = { type: "none", text: "", images: [] };
        if (!raw || typeof raw !== "object") return empty;

        let type = typeof raw.type === "string" ? raw.type.toLowerCase().trim() : "";
        if (!["none", "text", "image", "combined"].includes(type)) {
            type = "";
        }

        const textCandidates = [];
        if (typeof raw.text === "string") textCandidates.push(raw.text);
        if (typeof raw.content === "string") textCandidates.push(raw.content);
        const text = (textCandidates.find((v) => v && v.trim().length) || "").trim();

        const imageCandidates = [];
        const pushImage = (value) => {
            const serialized = this.serializeImageReference(value);
            if (!serialized) return;
            imageCandidates.push(serialized);
        };
        if (Array.isArray(raw.images)) raw.images.forEach(pushImage);
        if (raw.image) pushImage(raw.image);
        if (
            typeof raw.content === "string" &&
            (!raw.type || raw.type === "image" || raw.type === "combined")
        ) {
            pushImage(raw.content);
        }
        const uniqueImages = [];
        const seen = new Set();
        imageCandidates.forEach((img) => {
            const ref = this.normalizeImageReference(img);
            const key = ref
                ? `${ref.asset_url || ""}::${ref.asset_id || ""}::${ref.path || ""}`
                : String(img);
            if (seen.has(key)) return;
            seen.add(key);
            uniqueImages.push(img);
        });
        const images = uniqueImages.slice(0, this.maxAdditionalImages || 3);

        if (!type) {
            if (text && images.length) type = "combined";
            else if (images.length) type = "image";
            else if (text) type = "text";
            else type = "none";
        }

        if (!preserveEmptyType) {
            if (type === "text" && !text) return empty;
            if (type === "image" && !images.length) return empty;
            if (type === "combined" && !text && !images.length) return empty;
        }

        return { type, text, images };
    }

    serializeAdditionalInfo(source = this.additionalInfo) {
        const normalized = this.normalizeAdditionalInfo(source);
        if (!normalized || normalized.type === "none") return null;

        const payload = { type: normalized.type };
        if (normalized.type === "text") {
            payload.text = normalized.text;
        } else if (normalized.type === "image") {
            payload.images = normalized.images.slice(0, this.maxAdditionalImages || 3);
        } else if (normalized.type === "combined") {
            if (normalized.text) payload.text = normalized.text;
            if (normalized.images.length) payload.images = normalized.images.slice(0, this.maxAdditionalImages || 3);
        }
        return payload;
    }

    buildLiveAdditionalInfoState() {
        const live = this.normalizeAdditionalInfo(this.additionalInfo, { preserveEmptyType: true });

        if (this.additionalTypeSelect) {
            const value = String(this.additionalTypeSelect.value || "none").toLowerCase();
            live.type = ["none", "text", "image", "combined"].includes(value) ? value : "none";
        }

        if (this.additionalTextArea && (live.type === "text" || live.type === "combined")) {
            live.text = String(this.additionalTextArea.value || "");
        }

        if (live.type === "none") {
            live.text = "";
            live.images = [];
        } else if (live.type === "text") {
            live.images = [];
        } else if (live.type === "image") {
            live.text = "";
        }

        return this.normalizeAdditionalInfo(live, { preserveEmptyType: true });
    }

    // Legacy helper stubs to unblock error_detection flow
    getTaskContentForSave() {
        return this.ensureTaskContentObject();
    }

    buildLiveSettingsSnapshot() {
        const sourceSettings = this.task?.task_data?.settings;
        const snapshot =
            sourceSettings && typeof sourceSettings === "object"
                ? JSON.parse(JSON.stringify(sourceSettings))
                : {};

        if (this.isErrorDetectionTask()) {
            delete snapshot.success_threshold;
            delete snapshot.allowed_difficulties;
            delete snapshot.available_difficulties;
            return snapshot;
        }

        const rawThreshold = this.requiredCorrectInput
            ? parseInt(this.requiredCorrectInput.value, 10)
            : Number(
                this.task?.task_data?.settings?.success_threshold ??
                this.task?.task_data?.content?.required_correct
            );

        if (Number.isFinite(rawThreshold) && rawThreshold >= 1) {
            snapshot.success_threshold = rawThreshold;
        } else {
            delete snapshot.success_threshold;
        }

        return snapshot;
    }

    getTaskSettingsForSave() {
        return this.buildLiveSettingsSnapshot();
    }

    renderAdditionalInfo() {
        if (!this.additionalTypeSelect) return;

        const normalized = this.normalizeAdditionalInfo(this.additionalInfo, { preserveEmptyType: true });
        this.additionalInfo = normalized;

        this.additionalTypeSelect.value = normalized.type;
        if (this.additionalTextArea) {
            this.additionalTextArea.value = normalized.text || "";
        }

        const showText = normalized.type === "text" || normalized.type === "combined";
        const showImages = normalized.type === "image" || normalized.type === "combined";

        if (this.additionalTextGroup) {
            this.additionalTextGroup.classList.toggle("hidden", !showText);
        }
        if (this.additionalImagesGroup) {
            this.additionalImagesGroup.classList.toggle("hidden", !showImages);
        }

        if (this.additionalImagesGrid) {
            this.additionalImagesGrid.innerHTML = "";
            const images = Array.isArray(normalized.images) ? normalized.images : [];
            images.forEach((imageRef, idx) => {
                const previewSrc = this.resolveLocalImagePreviewSrc(imageRef);
                if (!previewSrc) return;
                const card = document.createElement("div");
                card.className = "group relative h-20 rounded-lg border border-border-subtle bg-surface-2 overflow-hidden";

                const previewBtn = document.createElement("button");
                previewBtn.type = "button";
                previewBtn.className = "h-full w-full";
                const img = document.createElement("img");
                img.src = previewSrc;
                img.alt = `additional-${idx + 1}`;
                img.className = "h-full w-full object-cover";
                previewBtn.appendChild(img);
                previewBtn.addEventListener("click", () => this.showImagePreview(img.src));

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "absolute top-1 right-1 hidden group-hover:flex items-center justify-center rounded-full bg-scrim text-white w-6 h-6";
                removeBtn.textContent = "x";
                removeBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.additionalInfo.images = (this.additionalInfo.images || []).filter((_, imageIdx) => imageIdx !== idx);
                    this.additionalInfoDirty = true;
                    this.markUnsaved();
                    this.renderAdditionalInfo();
                });

                card.appendChild(previewBtn);
                card.appendChild(removeBtn);
                this.additionalImagesGrid.appendChild(card);
            });
        }

        const imagesCount = Array.isArray(normalized.images) ? normalized.images.length : 0;
        if (this.additionalImagesEmpty) {
            this.additionalImagesEmpty.classList.toggle("hidden", imagesCount > 0);
        }
        if (this.additionalAddImageBtn) {
            const canAdd = imagesCount < (this.maxAdditionalImages || 3);
            this.additionalAddImageBtn.disabled = !canAdd;
            this.additionalAddImageBtn.classList.toggle("opacity-50", !canAdd);
            this.additionalAddImageBtn.classList.toggle("pointer-events-none", !canAdd);
        }
    }

    handleAdditionalTypeChange(event) {
        const value = String(event?.target?.value || "none").toLowerCase();
        const nextType = ["none", "text", "image", "combined"].includes(value) ? value : "none";
        this.additionalInfo.type = nextType;
        if (nextType === "none") {
            this.additionalInfo.text = "";
            this.additionalInfo.images = [];
        }
        if (nextType === "text") {
            this.additionalInfo.images = [];
        }
        if (nextType === "image") {
            this.additionalInfo.text = "";
        }
        this.additionalInfoDirty = true;
        this.markUnsaved();
        this.renderAdditionalInfo();
    }

    handleAdditionalTextInput(event) {
        this.additionalInfo.text = String(event?.target?.value || "");
        this.additionalInfoDirty = true;
        this.markUnsaved();
    }

    handleAdditionalAddImage() {
        if (!this.additionalImageInput) return;
        this.additionalImageInput.click();
    }

    async handleAdditionalImageUpload(event) {
        const file = event?.target?.files?.[0];
        if (!file || !this.task) return;

        const currentImages = Array.isArray(this.additionalInfo.images) ? this.additionalInfo.images : [];
        if (currentImages.length >= (this.maxAdditionalImages || 3)) {
            event.target.value = "";
            return;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("module", this.moduleId || this.task.task_data?.meta?.module || "");
        formData.append("topic", this.topicId || this.task.task_data?.meta?.topic || "");
        formData.append("task", this.taskId || this.task.metadata?.id || this.task.task_data?.meta?.id || "");

        try {
            const response = await fetch("/api/editor/upload-image", {
                method: "POST",
                body: formData
            });
            const data = await response.json();
            if (!response.ok || !data?.ok || (!data?.path && !data?.asset_id && !data?.asset_url)) {
                this.showToast(`Ошибка загрузки дополнительного изображения: ${data?.error || "upload_failed"}`, "error");
                return;
            }

            const nextImageRef = this.serializeImageReference({
                path: data.path,
                asset_id: data.asset_id,
                asset_url: data.asset_url,
            });
            if (!nextImageRef) {
                this.showToast("Не удалось подготовить ссылку на изображение.", "error");
                return;
            }
            this.additionalInfo.images = [...currentImages, nextImageRef].slice(0, this.maxAdditionalImages || 3);
            if (this.additionalInfo.type === "none") {
                this.additionalInfo.type = "image";
            } else if (this.additionalInfo.type === "text") {
                this.additionalInfo.type = "combined";
            }
            this.additionalInfoDirty = true;
            this.markUnsaved();
            this.renderAdditionalInfo();
        } catch (error) {
            console.error("Failed to upload additional image:", error);
            this.showToast("Ошибка при загрузке дополнительного изображения.", "error");
        } finally {
            event.target.value = "";
        }
    }

    showImagePreview(src) {
        if (!this.imagePreviewModal || !this.imagePreviewImg) return;
        this.imagePreviewImg.src = src || "";
        this.imagePreviewModal.classList.remove("hidden");
    }

    hideImagePreview() {
        if (!this.imagePreviewModal || !this.imagePreviewImg) return;
        this.imagePreviewModal.classList.add("hidden");
        this.imagePreviewImg.src = "";
    }

    detectTaskType() {
        const candidate =
            this.task?.task_data?.type ||
            this.task?.task_data?.task_type ||
            this.task?.task_type ||
            this.task?.type ||
            "click";
        this.taskType = candidate;
        this.isDrawTask = candidate === "draw" || candidate === "draw_task";
    }

    resetVertexEditingState() {
        this.selectedVertex = null;
        this.draggingVertex = null;
        this.vertexDragMoved = false;
    }

    cacheDom() {
        this.headerTitle = document.querySelector("header h2");
        this.promptArea = document.querySelector("#prompt-textarea");
        this.promptToggleBtn = document.querySelector("[data-prompt-toggle]");
        this.promptAreaWrapper = document.querySelector("[data-prompt-area]");
        this.choicePromptTextarea = document.querySelector("#choice-prompt-textarea");
        this.choicePromptToggleBtn = document.querySelector("[data-choice-prompt-toggle]");
        this.choicePromptAreaWrapper = document.querySelector("[data-choice-prompt-area]");
        this.requiredCorrectInput = document.querySelector("#required-correct-input");
        this.requiredCorrectContext = document.querySelector("#required-correct-context");
        this.requiredCorrectHint = document.querySelector("#required-correct-hint");
        this.modeSwitch = document.querySelector("#click-mode-switch");
        this.modeTextBtn = document.querySelector("#mode-text-btn");
        this.modeErrorsBtn = document.querySelector("#mode-errors-btn");
        this.subtaskToggle = document.querySelector("#subtask-toggle");
        this.clickModePane = document.querySelector("#click-mode-pane");
        this.errorsModePane = document.querySelector("#errors-mode-pane");
        this.choiceOptionsRadioName = `choice-variant-${Date.now()}`;

        this.img = document.querySelector("#main-image");
        this.imagePlaceholder = document.querySelector("#image-placeholder");
        this.canvasContainer = document.querySelector("#canvas-container");
        this.canvasStage = document.querySelector("#canvas-stage");
        this.overlay = document.querySelector("#annotation-overlay");
        this.overlayWrapper = document.querySelector("#canvas-layer");
        this.labelToggleBtn = document.querySelector("#toggle-label-visibility-btn");
        this.labelToggleText = document.querySelector("#label-visibility-mode-text");
        this.toolToggleButtons = Array.from(document.querySelectorAll(".tool-toggle"));
        this.freehandBtn = document.querySelector("#freehand-tool-btn");

        this.annotationList = document.querySelector("#annotation-list");
        this.annotationBadge = document.querySelector("[data-annotations-count]");
        this.statusBadge = document.querySelector("[data-drawing-status]");
        this.statusBadgeText = document.querySelector("[data-drawing-status-text]");
        this.statusBadgeIcon = document.querySelector("[data-drawing-status-icon]");
        this.toolbarRow = document.querySelector("#toolbar-row");
        this.toolbarStatusRow = document.querySelector("#toolbar-status-row");

        this.finishBtn = document.querySelector("#finish-polygon-btn");
        this.deleteLastPointBtn = document.querySelector("#delete-last-point-btn");
        this.cancelPolygonBtn = document.querySelector("#cancel-polygon-btn");
        this.clearAnnotationsBtn = document.querySelector("#clear-annotations-btn");
        this.lassoBtn = document.querySelector("#lasso-tool-btn");
        this.zoomInBtn = document.querySelector("#zoom-in-btn");
        this.zoomOutBtn = document.querySelector("#zoom-out-btn");
        this.zoomDisplay = document.querySelector("#zoom-level-display");

        this.publishBtn = document.querySelector("#save-task-btn");
        this.previewBtn = document.querySelector('header button');
        this.changeImageBtn = document.querySelector("#change-image-btn");
        this.imageUploadInput = document.querySelector("#main-image-upload");
        this.additionalTypeSelect = document.querySelector("#additional-type-select");
        this.additionalTextGroup = document.querySelector("#additional-text-group");
        this.additionalTextArea = document.querySelector("#additional-textarea");
        this.additionalImagesGroup = document.querySelector("#additional-images-group");
        this.additionalImagesGrid = document.querySelector("#additional-images-grid");
        this.additionalImagesEmpty = document.querySelector("#additional-images-empty");
        this.additionalAddImageBtn = document.querySelector("#additional-add-image-btn");
        this.additionalImageInput = document.querySelector("#additional-image-input");
        this.additionalInfoToggleBtn = document.querySelector("#additional-info-toggle-btn");
        this.additionalInfoContent = document.querySelector("#additional-info-content");
        this.additionalInfoToggleIcon = document.querySelector("#additional-info-toggle-icon");
        this.imagePreviewModal = document.querySelector("#image-preview-modal");
        this.imagePreviewImg = document.querySelector("#image-preview-img");
        this.imagePreviewClose = document.querySelector("#image-preview-close");
        this.saveButton = document.querySelector("#save-task-btn");
        this.saveStatusBadge = document.querySelector("[data-save-status]");
        this.saveStatusText = document.querySelector("[data-save-status-text]");
        this.saveStatusIcon = document.querySelector("[data-save-status-icon]");
    }

    async init() {
        const context = this.getTaskContext();
        this.moduleId = context.moduleId;
        this.topicId = context.topicId;
        this.taskId = context.taskId;
        this.isNewTaskParam = Boolean(context.isNewTask);
        this.restoreDraftIntent = Boolean(context.restoreDraft);
        this.taskTypeParam = String(context.taskType || "").trim();
        this.taskNameParam = String(context.taskName || "").trim();

        if (!this.moduleId || !this.topicId || !this.taskId) {
            console.error("Missing task parameters in URL");
            this.showFatalError("Неверная ссылка: отсутствуют параметры задания (module, topic, task)");
            return;
        }

        if (this.isNewTaskParam) {
            try {
                const response = await fetch(`/api/editor/task/${this.moduleId}/${this.topicId}/${this.taskId}`);
                const data = await response.json();
                if (response.ok && data?.ok && data.task) {
                    await this.loadTask(this.moduleId, this.topicId, this.taskId);
                    this.cleanupPersistedTaskRoute();
                    return;
                }
            } catch (error) {
                console.warn("[ClickEditor] Existing task load failed, trying bootstrap", error);
            }

            const bootstrap =
                this.readTaskBootstrap(this.moduleId, this.topicId, this.taskId) ||
                await this.fetchTaskBootstrap(this.moduleId, this.topicId, this.taskId, this.taskTypeParam, this.taskNameParam);

            if (!bootstrap) {
                this.showFatalError("Черновик не найден. Откройте создание задания заново.");
                return;
            }

            await this.hydrateTask(bootstrap, { persisted: false });
            return;
        }

        await this.loadTask(this.moduleId, this.topicId, this.taskId);
    }

    async loadTask(moduleId, topicId, taskId) {
        try {
            const response = await fetch(`/api/editor/task/${moduleId}/${topicId}/${taskId}`);
            const data = await response.json();
            if (!data.ok || (!data.path && !data.asset_id && !data.asset_url)) {
                console.error("Failed to load task:", data.error);
                this.showFatalError(data.error || "Не удалось загрузить задание");
                return;
            }

            await this.hydrateTask(data.task, { persisted: true });
        } catch (error) {
            console.error("Error fetching task:", error);
            this.showFatalError("Ошибка сети или сервера: " + error.message);
        }
    }

    async hydrateTask(task, options = {}) {
        const { persisted = true } = options;
        this.task = task;
        this.hasPersistedTask = Boolean(persisted);

        if (!this.autoSaveManager) {
            this.autoSaveManager = new AutoSaveManager(this, { interval: 30000 });
        }

        const lastSaved = persisted ? (this.task.task_data?.meta?.modified || 0) : 0;
        if (this.autoSaveManager.hasFresherDraft(lastSaved)) {
            const draft = this.autoSaveManager.loadDraft();
            if (this.shouldAutoRestoreDraft(draft)) {
                this.restoreState(draft.data);
                this.showToast(this.getAutoRestoreDraftToastMessage(), "info");
                this.autoSaveManager.start();
                this.hasUnsavedChanges = true;
                if (this.restoreDraftIntent) {
                    this.restoreDraftIntent = false;
                    this.cleanupPersistedTaskRoute();
                }
                return;
            }

            const recoveryCopy = this.buildDraftRecoveryCopy(draft, lastSaved);
            const shouldRestoreDraft = await this.confirmAction({
                title: recoveryCopy.title,
                message: recoveryCopy.message,
                confirmText: recoveryCopy.confirmText,
                cancelText: recoveryCopy.cancelText,
                variant: "info"
            });
            if (shouldRestoreDraft) {
                if (draft && draft.data) {
                    this.restoreState(draft.data);
                    this.autoSaveManager.start();
                    this.hasUnsavedChanges = true;
                    return;
                }
            }
        }

        this.autoSaveManager.start();
        if (this.restoreDraftIntent) {
            this.restoreDraftIntent = false;
            this.cleanupPersistedTaskRoute();
        }
        this.detectTaskType();
        this.resetImageMetrics();
        this.resetHighlightState();
        this.resetErrorDetectionState();
        this.hydrateErrorDetectionStateFromTask();
        const rawAnnotations = this.extractAnnotationsFromContent();
        this.annotations = this.normalizeAnnotations(rawAnnotations);
        this.additionalInfo = this.normalizeAdditionalInfo(this.task.task_data?.content?.additionalInfo);
        this.additionalInfoDirty = false;
        this.setupModeSwitch();
        this.renderUI();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn("[ClickEditor] difficulty authoring refresh failed", error);
        });
        setTimeout(() => {
            this.initialTaskSnapshot = this.captureTaskSnapshot();
            this.hasUnsavedChanges = false;
            this.updateSaveStatus(false);
        }, 0);
        this.updateErrorsSubpaneVisibility();
    }

    // ===== AUTOSAVE & UNDO/REDO SUPPORT =====

    buildLiveContentSnapshot() {
        const sourceContent = this.ensureTaskContentObject() || {};
        const snapshot = JSON.parse(JSON.stringify(sourceContent));
        
        // Ensure image is preserved even if stringification was flaky
        if (sourceContent.image) {
            snapshot.image = sourceContent.image;
        }
        
        const isErrorDetection = this.isErrorDetectionTask();

        if (this.promptArea) {
            snapshot.prompt = this.promptArea.value ?? "";
        }

        if (this.choicePromptTextarea) {
            const currentChoicePrompt = this.choicePromptTextarea.value ?? "";
            if (isErrorDetection) {
                const mode = this.errorDetection?.mode || snapshot.mode || "text_errors";
                if (mode === "text_choice") {
                    snapshot.choice_prompt = currentChoicePrompt || snapshot.prompt || "";
                } else {
                    delete snapshot.choice_prompt;
                }
            } else {
                snapshot.choice_prompt = currentChoicePrompt || snapshot.prompt || "";
            }
        }

        if (this.requiredCorrectInput && !isErrorDetection) {
            const requiredCorrect = parseInt(this.requiredCorrectInput.value, 10);
            if (Number.isFinite(requiredCorrect)) {
                snapshot.required_correct = requiredCorrect;
            }
        }

        if (!isErrorDetection) {
            snapshot.annotations = JSON.parse(JSON.stringify(this.annotations || []));
        }

        const liveAdditionalInfo = this.buildLiveAdditionalInfoState();
        const additionalPayload = this.serializeAdditionalInfo(liveAdditionalInfo);
        if (additionalPayload) {
            snapshot.additionalInfo = additionalPayload;
        } else {
            delete snapshot.additionalInfo;
        }

        return snapshot;
    }

    captureState() {
        return {
            // Core task data
            content: this.buildLiveContentSnapshot(),
            settings: this.getTaskSettingsForSave(),

            // Editor specific state
            annotations: JSON.parse(JSON.stringify(this.annotations)),
            additionalInfo: JSON.parse(JSON.stringify(
                this.buildLiveAdditionalInfoState()
            )),

            // Error detection state
            errorDetection: JSON.parse(JSON.stringify(this.errorDetection)),

            // View state (optional but helpful)
            zoomLevel: this.zoomLevel,
            panX: this.panX,
            panY: this.panY
        };
    }

    restoreState(state) {
        if (!state) return;

        // Restore core task data
        if (state.content) {
            this.task.task_data.content = state.content;
        }
        if (state.settings) {
            if (!this.task.task_data.settings) this.task.task_data.settings = {};
            Object.assign(this.task.task_data.settings, state.settings);
        }

        // Restore annotations
        if (state.annotations) {
            this.annotations = state.annotations;
        }

        // Restore additional info
        this.additionalInfo = this.normalizeAdditionalInfo(state.additionalInfo, { preserveEmptyType: true });

        // Restore Error detection state
        if (state.errorDetection) {
            this.errorDetection = state.errorDetection;
            // Re-hydrate UI for error detection
            if (this.errorsPaneInitialized) {
                this.populateErrorsPaneFromState();
            }
            this.updateErrorsSubpaneVisibility();
        }

        // Restore view state
        if (typeof state.zoomLevel === 'number') this.zoomLevel = state.zoomLevel;
        if (typeof state.panX === 'number') this.panX = state.panX;
        if (typeof state.panY === 'number') this.panY = state.panY;

        // Re-render everything
        this.detectTaskType();
        this.renderUI();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn("[ClickEditor] difficulty authoring refresh failed", error);
        });
        this.markUnsaved();
    }

    isErrorDetectionTask() {
        return Boolean(this.errorDetection.enabled || this.task?.task_data?.subtype === "error_detection");
    }

    validateErrorDetectionBeforeSave() {
        if (!this.isErrorDetectionTask()) {
            return true;
        }
        const mode = this.errorDetection.mode || (this.task?.task_data?.content?.mode ?? "text_errors");
        if (mode === "text_choice") {
            return this.validateChoiceModeBeforeSave();
        }
        return this.validateTextErrorsBeforeSave();
    }

    validateTextErrorsBeforeSave() {
        const text = (this.errorDetection.text || "").trim();
        if (!text) {
            this.showToast("Для режима «Ошибки в тексте» необходимо заполнить текст.", "error");
            this.ensureErrorsPaneLoaded();
            return false;
        }
        const spans = this.getErrorSpansArray();
        if (!Array.isArray(spans) || !spans.length) {
            this.showToast("Добавьте хотя бы одну ошибку (выделенный диапазон).", "error");
            return false;
        }
        const maxLen = text.length;
        for (let i = 0; i < spans.length; i += 1) {
            const { start, end } = spans[i];
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
                this.showToast(`Неверные границы у ошибки №${i + 1}. Проверьте выделения.`, "error");
                return false;
            }
            if (end > maxLen) {
                this.showToast(`Ошибка №${i + 1} выходит за пределы текста. Исправьте диапазон.`, "error");
                return false;
            }
        }
        return true;
    }

    validateChoiceModeBeforeSave() {
        const options = this.getChoiceOptionsArray();
        if (!Array.isArray(options) || options.length < 2) {
            this.showToast("Для режима выбора текста нужно минимум два варианта.", "error");
            return false;
        }
        const trimmedOptions = options.map((opt) => ({
            ...opt,
            text: (opt.text || "").trim()
        }));
        const emptyOption = trimmedOptions.findIndex((opt) => !opt.text.length);
        if (emptyOption !== -1) {
            this.showToast(`Заполните текст у варианта №${emptyOption + 1}.`, "error");
            return false;
        }
        const correctCount = trimmedOptions.filter((opt) => opt.is_correct).length;
        if (correctCount !== 1) {
            this.showToast("Должен быть ровно один правильный вариант.", "error");
            return false;
        }
        return true;
    }

    resetErrorDetectionState() {
        this.errorDetection = {
            enabled: false,
            mode: "text_errors",
            text: "",
            errorSpans: [],
            options: [],
            requiredCorrect: 1,
            requiredCorrectManual: false
        };
        this.currentSubtaskMode = "text";
        if (this.errorsPaneInitialized) {
            this.populateErrorsPaneFromState();
        }
        this.referenceData = {
            text: "",
            spans: []
        };
        this.referenceSelection = null;
        if (this.referencePaneInitialized) {
            this.populateReferencePaneFromState();
        }
    }

    hydrateErrorDetectionStateFromTask() {
        this.resetErrorDetectionState();
        const taskData = this.task?.task_data || {};
        const content = taskData.content || {};
        const metadataSubtype = this.task?.metadata?.subtype;
        const inferredSubtype =
            taskData.subtype ||
            content.subtype ||
            metadataSubtype ||
            (content.mode === "text_errors" ? "error_detection" : null) ||
            (Array.isArray(content.error_spans) && content.error_spans.length ? "error_detection" : null);
        const isErrorDetection = inferredSubtype === "error_detection";

        console.log('[DEBUG] hydrateErrorDetectionStateFromTask:', {
            taskData_subtype: taskData.subtype,
            content_subtype: content.subtype,
            content_mode: content.mode,
            metadataSubtype,
            inferredSubtype,
            isErrorDetection
        });

        if (!isErrorDetection) {
            console.log('[DEBUG] Not error detection task, returning early');
            return;
        }

        console.log('[DEBUG] Setting errorDetection.enabled = true, currentMode = "errors"');
        this.errorDetection.enabled = true;
        this.errorDetection.mode = content.mode === "text_choice" ? "text_choice" : "text_errors";
        this.errorDetection.text = typeof content.text === "string" ? content.text : "";
        this.errorDetection.errorSpans = Array.isArray(content.error_spans) ? [...content.error_spans] : [];
        this.errorDetection.options = Array.isArray(content.options) ? content.options.map((opt) => ({ ...opt })) : [];
        this.choiceOptionsIdCounter = Math.max(
            this.choiceOptionsIdCounter,
            this.errorDetection.options.reduce((max, opt) => {
                const match = String(opt?.id ?? "").match(/(\d+)$/);
                return Math.max(max, match ? Number(match[1]) : max);
            }, 0)
        );
        const { value: requiredCorrect, manual } = this.deriveErrorsRequiredCorrect(content);
        this.errorDetection.requiredCorrect = requiredCorrect;
        this.errorDetection.requiredCorrectManual = manual;
        this.applyErrorsRequiredCorrectToContent(content);
        this.currentMode = "errors";
        this.currentSubtaskMode = this.getSubpaneKeyForMode(this.errorDetection.mode);
        // Normalize subtype back into task_data for consistency
        this.task.task_data.subtype = "error_detection";
        content.subtype = "error_detection";
        this.loadReferenceDataFromContent(content);
        this.populateErrorsPaneFromState();
        this.populateReferencePaneFromState();
    }

    deriveErrorsRequiredCorrect(content) {
        const spans = Array.isArray(content.error_spans) ? content.error_spans : [];
        const total = Math.max(0, spans.length || 0);
        const raw = Number(content.required_correct);
        if (Number.isFinite(raw) && raw >= 1) {
            const cappedTotal = Math.max(total, 1);
            return { value: Math.min(raw, cappedTotal), manual: true };
        }
        return { value: total, manual: false };
    }

    applyErrorsRequiredCorrectToContent(content) {
        if (!content) return;
        const spans = Array.isArray(content.error_spans) ? content.error_spans : [];
        const maxAllowed = Math.max(0, spans.length || 0);
        let value = Number(this.errorDetection?.requiredCorrect);
        if (!Number.isFinite(value) || value < 0) {
            value = maxAllowed;
        } else if (value > maxAllowed) {
            value = maxAllowed;
            this.errorDetection.requiredCorrect = value;
        }
        content.required_correct = value;
    }

    refreshErrorsRequiredCorrectUI(forceInputUpdate = false) {
        if (!this.errorsPaneInitialized) return;
        const spans = this.getErrorSpansArray();
        this.syncErrorsRequiredCorrectWithTotal(spans.length, { forceInputUpdate });
        this.updateErrorsRequiredCurrentLabel();
    }

    syncErrorsRequiredCorrectWithTotal(total, options = {}) {
        const { forceInputUpdate = false } = options;
        const maxAllowed = Math.max(total, 0);
        const minAllowed = total === 0 ? 0 : 1;
        let changed = false;
        if (!this.errorDetection.requiredCorrectManual) {
            if (this.errorDetection.requiredCorrect !== maxAllowed) {
                this.errorDetection.requiredCorrect = maxAllowed;
                changed = true;
            }
        } else if (this.errorDetection.requiredCorrect > maxAllowed) {
            this.errorDetection.requiredCorrect = maxAllowed;
            changed = true;
        }
        if (this.errorsRequiredCorrectInput) {
            this.errorsRequiredCorrectInput.min = String(minAllowed);
            this.errorsRequiredCorrectInput.max = String(Math.max(maxAllowed, 1));
            if (forceInputUpdate || changed) {
                this.errorsRequiredCorrectInput.value = String(
                    Number.isFinite(this.errorDetection.requiredCorrect) ? this.errorDetection.requiredCorrect : minAllowed
                );
            }
        }
        if (changed) {
            const content = this.ensureTaskContentObject();
            if (content) {
                this.applyErrorsRequiredCorrectToContent(content);
            }
        }
        this.updateErrorsRequiredCurrentLabel();
    }

    updateErrorsRequiredCurrentLabel() {
        if (!this.errorsPaneInitialized || !this.errorsRequiredCurrentLabel) return;
        const value = Number.isFinite(this.errorDetection.requiredCorrect) ? this.errorDetection.requiredCorrect : 0;
        this.errorsRequiredCurrentLabel.textContent = String(value);
    }

    ensureTaskContentObject() {
        if (!this.task) return null;
        if (!this.task.task_data) {
            this.task.task_data = {};
        }
        if (!this.task.task_data.content || typeof this.task.task_data.content !== "object") {
            this.task.task_data.content = {};
        }
        return this.task.task_data.content;
    }

    loadReferenceDataFromContent(content) {
        if (!content) return;
        const text =
            typeof content.reference_text === "string"
                ? content.reference_text.slice(0, this.referenceCharLimit)
                : "";
        const spans = Array.isArray(content.reference_spans) ? content.reference_spans : [];
        this.referenceData = {
            text,
            spans: spans
                .map((span) => ({
                    start: Number(span?.start ?? 0),
                    end: Number(span?.end ?? 0)
                }))
                .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
        };
        this.sanitizeReferenceSpansAgainstText({ skipRender: true, referenceText: text });
        content.reference_text = this.referenceData.text;
        content.reference_spans = this.referenceData.spans.map((span) => ({ ...span }));
    }

    applyReferenceDataToContent(content) {
        if (!content || !this.isErrorDetectionTask()) return;
        const referenceText = this.referenceData?.text ?? "";
        const spans = Array.isArray(this.referenceData?.spans) ? this.referenceData.spans : [];
        content.reference_text = referenceText;
        content.reference_spans = spans.map((span) => ({
            start: span.start,
            end: span.end
        }));
    }

    sanitizeReferenceSpansAgainstText(options = {}) {
        const referenceText = typeof options.referenceText === "string" ? options.referenceText : this.referenceData?.text || "";
        const maxLen = referenceText.length;
        const spans = Array.isArray(this.referenceData?.spans) ? this.referenceData.spans : [];
        let changed = false;
        for (let i = spans.length - 1; i >= 0; i -= 1) {
            const span = spans[i];
            if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) {
                spans.splice(i, 1);
                changed = true;
                continue;
            }
            const start = Math.max(0, Math.min(span.start, maxLen));
            const end = Math.max(start, Math.min(span.end, maxLen));
            if (end <= start) {
                spans.splice(i, 1);
                changed = true;
                continue;
            }
            if (start !== span.start || end !== span.end) {
                span.start = start;
                span.end = end;
                changed = true;
            }
        }
        if (changed && !options.skipRender) {
            this.renderReferenceSpanList?.();
            this.renderReferencePreview?.();
        }
    }

    enableErrorDetectionEditor() {
        const content = this.getTaskContentForSave();
        this.applyReferenceDataToContent(content);
        const settings = this.getTaskSettingsForSave();
        const wasEnabled = this.errorDetection.enabled;
        this.errorDetection.enabled = true;
        this.task.task_data.subtype = "error_detection";

        if (typeof content.mode !== "string") {
            content.mode = this.errorDetection.mode || "text_errors";
        }
        this.errorDetection.mode = content.mode === "text_choice" ? "text_choice" : "text_errors";
        this.currentSubtaskMode = this.getSubpaneKeyForMode(this.errorDetection.mode);

        if (typeof content.text !== "string") {
            content.text = this.errorDetection.text || "";
        }
        this.errorDetection.text = content.text;

        const derived = this.deriveErrorsRequiredCorrect(content);
        this.errorDetection.requiredCorrect = derived.value;
        this.errorDetection.requiredCorrectManual = derived.manual;
        this.applyErrorsRequiredCorrectToContent(content);
        this.loadReferenceDataFromContent(content);

        if (!Array.isArray(content.error_spans)) {
            content.error_spans = [...this.errorDetection.errorSpans];
        } else {
            this.errorDetection.errorSpans = content.error_spans;
        }

        if (!Array.isArray(content.options)) {
            content.options = [...this.errorDetection.options];
        }
        this.populateErrorsPaneFromState();
        this.populateReferencePaneFromState();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn("[ClickEditor] difficulty authoring refresh failed", error);
        });
    }

    initErrorsPaneComponents() {
        if (this.errorsPaneInitialized || !this.errorsModePane) return;
        const scope = this.errorsModePane;
        this.errorsPromptPreviewEl = scope.querySelector("[data-errors-prompt-preview]");
        this.errorsTextEditor = scope.querySelector("[data-errors-text-editor]");
        this.errorsHighlightLayer = scope.querySelector("[data-errors-highlight-layer]");
        this.errorsAddSpanBtn = scope.querySelector("[data-errors-add-span-btn]");
        this.errorsSelectionHint = scope.querySelector("[data-errors-selection-hint]");
        this.errorsRequiredCorrectInput = scope.querySelector("[data-errors-required-correct]");
        this.errorsRequiredCurrentLabel = scope.querySelector("[data-errors-required-current]");
        this.errorsTotalCountLabel = scope.querySelector("[data-errors-total-count]");
        this.errorsRequireAllCheckbox = scope.querySelector("[data-errors-require-all]");
        this.errorsClearAllBtn = scope.querySelector("[data-errors-clear-all]");
        this.errorsSpanList = scope.querySelector("[data-errors-span-list]");
        this.errorsSpanEmptyState = scope.querySelector("[data-errors-spans-empty]");
        this.choicePromptPreviewEl = scope.querySelector("[data-choice-prompt-preview]");
        this.choiceOptionsList = scope.querySelector("[data-choice-options-list]");
        this.choiceOptionsEmptyState = scope.querySelector("[data-choice-options-empty]");
        this.choiceAddOptionBtn = scope.querySelector("[data-choice-add-option]");
        this.choiceWarning = scope.querySelector("[data-choice-warning]");
        this.promptToggleBtn = scope.querySelector("[data-prompt-toggle]") || this.promptToggleBtn;
        this.promptAreaWrapper = scope.querySelector("[data-prompt-area]") || this.promptAreaWrapper;
        this.choicePromptToggleBtn = scope.querySelector("[data-choice-prompt-toggle]") || this.choicePromptToggleBtn;
        this.choicePromptAreaWrapper = scope.querySelector("[data-choice-prompt-area]") || this.choicePromptAreaWrapper;
        this.choicePromptTextarea = scope.querySelector("#choice-prompt-textarea") || this.choicePromptTextarea;

        this.referenceSection = scope.querySelector("[data-reference-section]");
        this.referenceTextEditor = scope.querySelector("[data-reference-text-editor]");
        this.referenceHighlightLayer = scope.querySelector("[data-reference-highlight-layer]");
        this.referenceAddSpanBtn = scope.querySelector("[data-reference-add-span-btn]");
        this.referenceSelectionHint = scope.querySelector("[data-reference-selection-hint]");
        this.referenceSpanList = scope.querySelector("[data-reference-span-list]");
        this.referenceSpanEmptyState = scope.querySelector("[data-reference-spans-empty]");
        this.referenceCopyBtn = scope.querySelector("[data-reference-copy-btn]");
        this.referenceClearAllBtn = scope.querySelector("[data-reference-clear-all]");
        this.referenceCharCounter = scope.querySelector("[data-reference-char-counter]");
        this.textPaneToggleButtons = Array.from(scope.querySelectorAll("[data-pane-toggle]"));
        this.textPanes = Array.from(scope.querySelectorAll("[data-pane]"));

        this.errorsPaneInitialized = true;

        if (this.errorsTextEditor) {
            this.errorsTextEditor.addEventListener("input", () => this.handleErrorsTextInput());
            ["select", "keyup", "click"].forEach((eventName) => {
                this.errorsTextEditor.addEventListener(eventName, () => this.handleErrorsTextSelection());
            });
            this.errorsTextEditor.addEventListener("scroll", () => this.syncErrorsHighlightScroll());
        }

        if (this.errorsAddSpanBtn) {
            this.errorsAddSpanBtn.addEventListener("click", () => this.handleErrorsAddSpan());
        }

        if (this.errorsRequiredCorrectInput && !this.errorsRequiredCorrectInputListenerAttached) {
            this.errorsRequiredCorrectInputListenerAttached = true;
            this.errorsRequiredCorrectInput.addEventListener("input", () => this.handleErrorsRequiredCorrectInput());
            this.errorsRequiredCorrectInput.addEventListener("blur", () => this.handleErrorsRequiredCorrectInput());
        }

        if (this.errorsClearAllBtn) {
            this.errorsClearAllBtn.addEventListener("click", () => this.handleErrorsClearAll());
        }

        if (this.choiceAddOptionBtn) {
            this.choiceAddOptionBtn.addEventListener("click", () => this.handleChoiceAddOption());
        }

        this.populateErrorsPaneFromState();
        this.initReferencePaneComponents();
        this.initTextPaneToggle();
        this.initPromptToggle();
        this.initChoicePromptToggle();
    }

    populateErrorsPaneFromState() {
        if (!this.errorsPaneInitialized) {
            return;
        }
        if (this.errorsPromptPreviewEl) {
            const prompt = this.task?.task_data?.content?.prompt || "";
            this.errorsPromptPreviewEl.textContent = prompt ? prompt : "—";
        }
        if (this.choicePromptTextarea) {
            const content = this.task?.task_data?.content || {};
            const savedChoicePrompt = content.choice_prompt || content.prompt || "";
            this.choicePromptTextarea.value = savedChoicePrompt;
        }
        if (this.errorsTextEditor) {
            this.errorsTextEditor.value = this.errorDetection.text || "";
        }
        if (this.errorsRequireAllCheckbox) {
            const requireAll = this.task?.task_data?.content?.require_all_errors ?? true;
            this.errorsRequireAllCheckbox.checked = requireAll;
        }
        this.updateErrorsTotalCount();
        this.refreshErrorsRequiredCorrectUI(true);
        this.renderErrorsHighlightLayer();
        this.renderErrorsSpanList();
        this.updateErrorsAddButtonState();
        this.populateChoicePaneFromState();
    }

    renderErrorsHighlightLayer() {
        if (!this.errorsPaneInitialized || !this.errorsHighlightLayer || !this.errorsTextEditor) {
            return;
        }
        const text = this.errorDetection.text || "";
        if (!text) {
            this.errorsHighlightLayer.innerHTML = "";
            this.syncErrorsHighlightScroll();
            return;
        }
        const spans = [...this.getErrorSpansArray()];
        const html = this.renderSpansToHtml(text, spans, "highlight-error");

        this.errorsHighlightLayer.innerHTML = html;
        this.syncErrorsHighlightScroll();
    }

    syncErrorsHighlightScroll() {
        if (!this.errorsHighlightLayer || !this.errorsTextEditor) return;
        const scrollTop = this.errorsTextEditor.scrollTop || 0;
        const scrollLeft = this.errorsTextEditor.scrollLeft || 0;
        this.errorsHighlightLayer.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }

    // --- Helper for processing spans (handles overlaps) ---
    renderSpansToHtml(text, spans, highlightClass) {
        if (!text) return "";
        const len = text.length;

        // 1. Collect all boundary points (start and end)
        const points = new Set([0, len]);
        spans.forEach(span => {
            const start = Math.max(0, Math.min(span.start ?? 0, len));
            const end = Math.max(start, Math.min(span.end ?? start, len));
            if (end > start) {
                points.add(start);
                points.add(end);
            }
        });

        // 2. Sort points to create atomic intervals
        const sortedPoints = Array.from(points).sort((a, b) => a - b);

        const segments = [];

        // 3. Iterate intervals and determine if highlighted
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const start = sortedPoints[i];
            const end = sortedPoints[i + 1];
            const mid = (start + end) / 2; // Sample point to check overlap

            // Check if this interval is covered by ANY span
            const isHighlighted = spans.some(span => {
                const s = Math.max(0, Math.min(span.start ?? 0, len));
                const e = Math.max(s, Math.min(span.end ?? s, len));
                return s <= mid && e >= mid;
            });

            segments.push({ start, end, isHighlighted });
        }

        // 4. Build HTML
        return segments.map(seg => {
            const content = text.slice(seg.start, seg.end);
            if (!content) return "";
            const escaped = escapeHtml(content);
            if (seg.isHighlighted) {
                return `<span class="${highlightClass}">${escaped}</span>`;
            }
            return `<span>${escaped}</span>`;
        }).join("");
    }

    initReferencePaneComponents() {
        if (this.referencePaneInitialized || !this.errorsModePane) return;
        const scope = this.errorsModePane;
        this.referenceSection = scope.querySelector("[data-reference-section]");
        this.referenceTextEditor = scope.querySelector("[data-reference-text-editor]");
        this.referenceHighlightLayer = scope.querySelector("[data-reference-highlight-layer]");
        this.referenceAddSpanBtn = scope.querySelector("[data-reference-add-span-btn]");
        this.referenceSelectionHint = scope.querySelector("[data-reference-selection-hint]");
        this.referenceSpanList = scope.querySelector("[data-reference-span-list]");
        this.referenceSpanEmptyState = scope.querySelector("[data-reference-spans-empty]");
        this.referenceCopyBtn = scope.querySelector("[data-reference-copy-btn]");
        this.referenceClearAllBtn = scope.querySelector("[data-reference-clear-all]");
        this.referenceCharCounter = scope.querySelector("[data-reference-char-counter]");

        if (!this.referenceSection) {
            this.referencePaneInitialized = true;
            return;
        }

        if (this.referenceTextEditor) {
            this.referenceTextEditor.addEventListener("input", () => this.handleReferenceTextInput());
            ["select", "click", "keyup"].forEach((eventName) => {
                this.referenceTextEditor.addEventListener(eventName, () => this.handleReferenceTextSelection());
            });
            this.referenceTextEditor.addEventListener("scroll", () => this.syncReferenceHighlightScroll());
        }

        if (this.referenceAddSpanBtn) {
            this.referenceAddSpanBtn.addEventListener("click", () => this.handleReferenceAddSpan());
        }

        if (this.referenceCopyBtn) {
            this.referenceCopyBtn.addEventListener("click", () => this.handleReferenceCopyFromErrors());
        }

        if (this.referenceClearAllBtn) {
            this.referenceClearAllBtn.addEventListener("click", () => this.handleReferenceClearAll());
        }

        this.referencePaneInitialized = true;
        this.populateReferencePaneFromState();
    }

    populateReferencePaneFromState() {
        if (!this.referencePaneInitialized) {
            return;
        }
        if (this.referenceTextEditor) {
            this.referenceTextEditor.value = this.referenceData.text || "";
        }
        this.updateReferenceCharCounter();
        this.updateReferenceAddButtonState();
        this.renderReferencePreview();
        this.renderReferenceSpanList();
    }

    initTextPaneToggle() {
        if (!this.textPaneToggleButtons?.length || !this.textPanes?.length) return;
        this.textPaneToggleButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const key = btn.dataset.paneToggle || "primary";
                this.setActiveTextPane(key);
            });
        });
        const initial =
            this.textPaneToggleButtons.find((btn) => btn.classList.contains("pane-active"))?.dataset.paneToggle ||
            this.currentTextPane ||
            "primary";
        this.setActiveTextPane(initial);
    }

    setActiveTextPane(key) {
        this.currentTextPane = key === "reference" ? "reference" : "primary";
        this.updateTextPaneVisibility();
    }

    updateTextPaneVisibility() {
        if (!this.textPanes?.length || !this.textPaneToggleButtons?.length) return;
        this.textPanes.forEach((pane) => {
            const shouldShow = pane.dataset.pane === this.currentTextPane;
            pane.classList.toggle("hidden", !shouldShow);
        });
        this.textPaneToggleButtons.forEach((btn) => {
            const isActive = btn.dataset.paneToggle === this.currentTextPane;
            this.currentTextPane = isActive ? btn.dataset.paneToggle : this.currentTextPane;
        });
        this.textPaneToggleButtons.forEach((btn) => {
            const isActive = btn.dataset.paneToggle === this.currentTextPane;
            const icon = btn.querySelector(".material-symbols-outlined");
            btn.classList.toggle("pane-active", isActive);
            btn.classList.toggle("pane-inactive", !isActive);

            // Clean up any inline styles
            btn.style.cssText = "";
            if (icon) {
                icon.style.cssText = "";
            }

            if (isActive) {
                btn.classList.add("bg-primary", "text-primary-contrast", "border-primary");
                btn.classList.remove("bg-surface-1", "text-text-main", "border-border-subtle", "bg-text-main");
            } else {
                btn.classList.remove("bg-primary", "text-primary-contrast", "border-primary", "bg-text-main");
                btn.classList.add("bg-surface-1", "text-text-main", "border", "border-border-subtle");
            }
        });
    }

    updateReferenceCharCounter() {
        if (!this.referenceCharCounter) return;
        const len = (this.referenceData.text || "").length;
        this.referenceCharCounter.textContent = `${len}`;
    }

    handleReferenceTextInput() {
        if (!this.referenceTextEditor) return;
        const newValue = this.referenceTextEditor.value ?? "";
        if (this.referenceData.text === newValue) {
            this.handleReferenceTextSelection();
            return;
        }
        this.referenceData.text = newValue.slice(0, this.referenceCharLimit);
        if (this.referenceTextEditor.value !== this.referenceData.text) {
            this.referenceTextEditor.value = this.referenceData.text;
        }
        this.updateReferenceCharCounter();
        this.sanitizeReferenceSpansAgainstText({ referenceText: this.referenceData.text });
        this.renderReferencePreview();
        this.renderReferenceSpanList();
        this.updateReferenceAddButtonState();
        this.markUnsaved();
    }

    handleReferenceTextSelection() {
        if (!this.referenceTextEditor) return;
        const start = this.referenceTextEditor.selectionStart ?? 0;
        const end = this.referenceTextEditor.selectionEnd ?? start;
        if (typeof start !== "number" || typeof end !== "number" || start === end) {
            this.referenceSelection = null;
        } else {
            const rawStart = Math.max(0, Math.min(start, end));
            const rawEnd = Math.max(0, Math.max(start, end));
            const text = this.referenceTextEditor.value ?? "";
            let trimmedStart = rawStart;
            let trimmedEnd = rawEnd;
            while (trimmedStart < trimmedEnd && /\s/.test(text.charAt(trimmedStart))) {
                trimmedStart += 1;
            }
            while (trimmedEnd > trimmedStart && /\s/.test(text.charAt(trimmedEnd - 1))) {
                trimmedEnd -= 1;
            }
            if (trimmedEnd <= trimmedStart) {
                this.referenceSelection = null;
            } else {
                this.referenceSelection = { start: trimmedStart, end: trimmedEnd };
            }
        }
        this.updateReferenceAddButtonState();
    }

    updateReferenceAddButtonState() {
        if (!this.referenceAddSpanBtn) return;
        const hasSelection = Boolean(this.referenceSelection && this.referenceSelection.end > this.referenceSelection.start);
        this.referenceAddSpanBtn.disabled = !hasSelection;
        if (this.referenceSelectionHint) {
            this.referenceSelectionHint.classList.toggle("text-text-muted", hasSelection);
            this.referenceSelectionHint.classList.toggle("text-text-muted", !hasSelection);
        }
    }

    getReferenceSpansArray() {
        if (!Array.isArray(this.referenceData.spans)) {
            this.referenceData.spans = [];
        }
        return this.referenceData.spans;
    }

    handleReferenceAddSpan() {
        if (!this.referenceSelection) return;
        const text = this.referenceData.text || "";
        if (!text) return;
        const { start, end } = this.referenceSelection;
        if (end <= start) return;
        const spans = this.getReferenceSpansArray();
        spans.push({ start, end });
        this.referenceSelection = null;
        this.sanitizeReferenceSpansAgainstText({ referenceText: text });
        this.renderReferenceSpanList();
        this.renderReferencePreview();
        this.updateReferenceAddButtonState();
        this.markUnsaved();
    }

    handleReferenceDeleteSpan(index) {
        const spans = this.getReferenceSpansArray();
        if (index < 0 || index >= spans.length) return;
        spans.splice(index, 1);
        this.renderReferenceSpanList();
        this.renderReferencePreview();
        this.markUnsaved();
    }

    handleReferenceJumpToSpan(index) {
        if (!this.referenceTextEditor) return;
        const spans = this.getReferenceSpansArray();
        if (index < 0 || index >= spans.length) return;
        const text = this.referenceData.text || "";
        const start = Math.max(0, Math.min(spans[index].start ?? 0, text.length));
        const end = Math.max(start, Math.min(spans[index].end ?? start, text.length));
        this.referenceTextEditor.focus();
        this.referenceTextEditor.setSelectionRange(start, end);
        this.handleReferenceTextSelection();
    }

    handleReferenceClearAll() {
        const spans = this.getReferenceSpansArray();
        if (!spans.length) return;
        spans.splice(0, spans.length);
        this.renderReferenceSpanList();
        this.renderReferencePreview();
        this.markUnsaved();
    }

    handleReferenceCopyFromErrors() {
        const sourceText = this.errorDetection?.text || this.task?.task_data?.content?.text || "";
        if (!sourceText) return;
        this.referenceData.text = sourceText.slice(0, this.referenceCharLimit);
        this.referenceData.spans = [];
        if (this.referenceTextEditor) {
            this.referenceTextEditor.value = this.referenceData.text;
        }
        this.updateReferenceCharCounter();
        this.sanitizeReferenceSpansAgainstText({ referenceText: this.referenceData.text });
        this.renderReferencePreview();
        this.renderReferenceSpanList();
        this.markUnsaved();
    }

    renderReferencePreview() {
        if (!this.referencePaneInitialized || !this.referenceHighlightLayer || !this.referenceTextEditor) return;
        const text = this.referenceData.text || "";
        if (!text) {
            this.referenceHighlightLayer.innerHTML = "";
            this.referenceHighlightLayer.classList.add("text-text-disabled");
            return;
        }
        const spans = [...this.getReferenceSpansArray()];
        const html = this.renderSpansToHtml(text, spans, "highlight-reference");

        this.referenceHighlightLayer.innerHTML = html;
        this.referenceHighlightLayer.classList.remove("text-text-disabled");
        this.syncReferenceHighlightScroll();
    }

    syncReferenceHighlightScroll() {
        if (!this.referenceHighlightLayer || !this.referenceTextEditor) return;
        const scrollTop = this.referenceTextEditor.scrollTop || 0;
        const scrollLeft = this.referenceTextEditor.scrollLeft || 0;
        this.referenceHighlightLayer.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }

    renderReferenceSpanList() {
        if (!this.referencePaneInitialized || !this.referenceSpanList || !this.referenceSpanEmptyState) return;
        const spans = this.getReferenceSpansArray();
        if (!spans.length) {
            this.referenceSpanEmptyState.classList.remove("hidden");
            this.referenceSpanList.innerHTML = "";
            return;
        }
        this.referenceSpanEmptyState.classList.add("hidden");
        const text = this.referenceData.text || "";
        const rows = spans
            .map((span, index) => {
                const start = span.start ?? 0;
                const end = span.end ?? start;
                const snippet = text.slice(start, end) || "";
                return `
                    <tr data-reference-span-row data-span-index="${index}">
                        <td class="px-4 py-3 text-xs font-semibold text-text-secondary align-top">${index + 1}</td>
                        <td class="px-4 py-3 align-top">
                            <div class="text-sm font-mono bg-surface-1 rounded border border-dashed border-border-subtle px-2 py-1">
                                ${snippet ? escapeHtml(snippet) : '<span class="text-text-disabled">Пусто</span>'}
                            </div>
                            <div class="mt-2 text-xs text-text-secondary">Диапазон: ${start}–${end}</div>
                        </td>
                        <td class="px-4 py-3 align-top">
                            <div class="flex flex-col gap-2 items-end">
                                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-success-dark border border-success-light rounded-lg hover:bg-success-lighter transition" data-reference-action="jump">
                                    Перейти
                                </button>
                                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-error border border-error-light rounded-lg hover:bg-error-lighter transition" data-reference-action="delete">
                                    Удалить
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join("");
        this.referenceSpanList.innerHTML = rows;
        this.attachReferenceSpanListEvents();
    }

    attachReferenceSpanListEvents() {
        if (!this.referenceSpanList) return;
        this.referenceSpanList.querySelectorAll("[data-reference-action='jump']").forEach((button) => {
            button.addEventListener("click", (event) => {
                const row = event.currentTarget.closest("[data-span-index]");
                const index = Number(row?.dataset?.spanIndex ?? "-1");
                this.handleReferenceJumpToSpan(index);
            });
        });
        this.referenceSpanList.querySelectorAll("[data-reference-action='delete']").forEach((button) => {
            button.addEventListener("click", (event) => {
                const row = event.currentTarget.closest("[data-span-index]");
                const index = Number(row?.dataset?.spanIndex ?? "-1");
                this.handleReferenceDeleteSpan(index);
            });
        });
    }

    updateErrorsPromptPreview() {
        if (!this.errorsPaneInitialized || !this.errorsPromptPreviewEl) return;
        const promptInput = this.promptArea ? this.promptArea.value.trim() : "";
        const prompt = promptInput || this.task?.task_data?.content?.prompt || "";
        const value = prompt || DEFAULT_PROMPT;
        this.errorsPromptPreviewEl.textContent = value;
    }

    updateChoicePromptPreview() {
        if (!this.errorsPaneInitialized || !this.choicePromptPreviewEl) return;
        const promptInput = this.choicePromptTextarea ? this.choicePromptTextarea.value.trim() : "";
        const fallbackPromptInput = this.promptArea ? this.promptArea.value.trim() : "";
        const content = this.task?.task_data?.content || {};
        const promptFromContent = content.choice_prompt || content.prompt || "";
        const prompt = promptInput || fallbackPromptInput || promptFromContent || "";
        const value = prompt || DEFAULT_CHOICE_PROMPT;
        this.choicePromptPreviewEl.textContent = value;
    }

    populateChoicePaneFromState() {
        if (!this.errorsPaneInitialized) return;
        this.updateChoicePromptPreview();
        this.renderChoiceOptionsList();
        this.updateChoiceValidationWarning();
    }

    getChoiceOptionsArray() {
        if (!Array.isArray(this.errorDetection.options)) {
            this.errorDetection.options = [];
        }
        const content = this.ensureTaskContentObject();
        if (content && !Array.isArray(content.options)) {
            content.options = this.errorDetection.options;
        }
        return this.errorDetection.options;
    }

    generateChoiceOptionId() {
        this.choiceOptionsIdCounter += 1;
        return `choice_option_${this.choiceOptionsIdCounter}`;
    }

    handleChoiceAddOption() {
        const options = this.getChoiceOptionsArray();
        const newOption = {
            id: this.generateChoiceOptionId(),
            text: "",
            is_correct: options.length === 0
        };
        options.push(newOption);
        const content = this.ensureTaskContentObject();
        if (content) {
            content.options = options;
        }
        this.ensureSingleCorrectOption();
        this.renderChoiceOptionsList();
        this.updateChoiceValidationWarning();
        this.markUnsaved();
    }

    handleChoiceDeleteOption(optionId) {
        const options = this.getChoiceOptionsArray();
        const index = options.findIndex((opt) => opt.id === optionId);
        if (index === -1) return;
        options.splice(index, 1);
        if (options.length && !options.some((opt) => opt.is_correct)) {
            options[0].is_correct = true;
        }
        this.renderChoiceOptionsList();
        this.updateChoiceValidationWarning();
        this.markUnsaved();
    }

    handleChoiceTextInput(optionId, value) {
        const options = this.getChoiceOptionsArray();
        const option = options.find((opt) => opt.id === optionId);
        if (!option) return;
        const next = value ?? "";
        if (option.text === next) return;
        option.text = next;
        this.markUnsaved();
    }

    handleChoiceCorrectToggle(optionId) {
        const options = this.getChoiceOptionsArray();
        let changed = false;
        options.forEach((opt) => {
            const shouldBeCorrect = opt.id === optionId;
            if (opt.is_correct !== shouldBeCorrect) {
                opt.is_correct = shouldBeCorrect;
                changed = true;
            }
        });
        if (changed) {
            this.renderChoiceOptionsList();
            this.updateChoiceValidationWarning();
            this.markUnsaved();
        }
    }

    ensureSingleCorrectOption() {
        const options = this.getChoiceOptionsArray();
        if (!options.length) return;
        const correct = options.filter((opt) => opt.is_correct);
        if (correct.length === 1) return;
        options.forEach((opt, index) => {
            opt.is_correct = index === 0;
        });
    }

    renderChoiceOptionsList() {
        if (!this.errorsPaneInitialized || !this.choiceOptionsList || !this.choiceOptionsEmptyState) return;
        const options = this.getChoiceOptionsArray();
        if (!options.length) {
            this.choiceOptionsEmptyState.classList.remove("hidden");
            this.choiceOptionsList.innerHTML = "";
            this.updateChoiceValidationWarning();
            return;
        }

        this.choiceOptionsEmptyState.classList.add("hidden");
        const rows = options
            .map((option) => {
                const isCorrect = Boolean(option.is_correct);
                const borderClass = isCorrect ? "border-2 border-primary" : "border border-border-subtle";
                const badge = isCorrect
                    ? `<div class="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-contrast text-[10px] uppercase font-bold tracking-wider rounded">
                            Правильный
                       </div>`
                    : "";
                return `
                    <div class="relative flex items-start gap-4 p-4 rounded-xl ${borderClass} bg-surface-1 shadow-sm hover:border-border-color transition-colors" data-choice-option-id="${option.id}">
                        <div class="pt-1.5">
                            <input type="radio" name="${this.choiceOptionsRadioName}" class="w-5 h-5 text-primary border-border-subtle bg-surface-2 focus:ring-primary cursor-pointer"
                                data-action="choice-correct" data-option-id="${option.id}" ${isCorrect ? "checked" : ""}/>
                        </div>
                        <div class="flex-1">
                            <textarea class="w-full bg-transparent border-0 p-0 text-sm leading-relaxed text-text-main placeholder-text-disabled focus:ring-0 resize-none custom-scrollbar h-24" spellcheck="false"
                                data-action="choice-text" data-option-id="${option.id}">${escapeHtml(option.text || "")}</textarea>
                        </div>
                        <button class="text-text-disabled hover:text-error transition-colors p-1.5 rounded-lg hover:bg-error-lighter" type="button" data-action="choice-delete" data-option-id="${option.id}">
                            <span class="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                        ${badge}
                    </div>
                `;
            })
            .join("");
        this.choiceOptionsList.innerHTML = rows;
        this.attachChoiceOptionEvents();
        this.updateChoiceValidationWarning();
    }

    attachChoiceOptionEvents() {
        if (!this.choiceOptionsList) return;
        this.choiceOptionsList.querySelectorAll("[data-action='choice-delete']").forEach((button) => {
            button.addEventListener("click", (event) => {
                const optionId = event.currentTarget.dataset.optionId;
                this.handleChoiceDeleteOption(optionId);
            });
        });
        this.choiceOptionsList.querySelectorAll("[data-action='choice-text']").forEach((textarea) => {
            textarea.addEventListener("input", (event) => {
                const optionId = event.currentTarget.dataset.optionId;
                this.handleChoiceTextInput(optionId, event.currentTarget.value);
            });
        });
        this.choiceOptionsList.querySelectorAll("[data-action='choice-correct']").forEach((radio) => {
            radio.addEventListener("change", (event) => {
                if (!event.currentTarget.checked) return;
                const optionId = event.currentTarget.dataset.optionId;
                this.handleChoiceCorrectToggle(optionId);
            });
        });
    }

    updateChoiceValidationWarning() {
        if (!this.choiceWarning) return;
        const options = this.getChoiceOptionsArray();
        const hasEnoughOptions = options.length >= 2;
        const correctCount = options.filter((opt) => opt.is_correct).length;
        const isValid = hasEnoughOptions && correctCount === 1;
        this.choiceWarning.classList.toggle("hidden", isValid || !options.length);
    }

    handleErrorsTextInput() {
        const textarea = this.errorsTextEditor;
        if (!textarea) return;
        const newValue = textarea.value ?? "";
        if (this.errorDetection.text === newValue) {
            this.handleErrorsTextSelection();
            return;
        }
        this.errorDetection.text = newValue;
        const content = this.ensureTaskContentObject();
        if (content) {
            content.text = newValue;
        }
        this.errorsTextSelection = null;
        this.sanitizeErrorSpansAgainstText();
        this.renderErrorsHighlightLayer();
        this.renderErrorsSpanList();
        this.updateErrorsAddButtonState();
        this.markUnsaved();
    }

    handleErrorsTextSelection() {
        const textarea = this.errorsTextEditor;
        if (!textarea) return;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        if (typeof start !== "number" || typeof end !== "number" || start === end) {
            this.errorsTextSelection = null;
        } else {
            const rawStart = Math.max(0, Math.min(start, end));
            const rawEnd = Math.max(0, Math.max(start, end));
            const text = textarea.value ?? "";
            let trimmedStart = rawStart;
            let trimmedEnd = rawEnd;
            while (trimmedStart < trimmedEnd && /\s/.test(text.charAt(trimmedStart))) {
                trimmedStart += 1;
            }
            while (trimmedEnd > trimmedStart && /\s/.test(text.charAt(trimmedEnd - 1))) {
                trimmedEnd -= 1;
            }
            if (trimmedEnd <= trimmedStart) {
                this.errorsTextSelection = null;
            } else {
                this.errorsTextSelection = { start: trimmedStart, end: trimmedEnd };
            }
        }
        this.updateErrorsAddButtonState();
    }

    updateErrorsAddButtonState() {
        if (!this.errorsAddSpanBtn) return;
        const hasSelection = Boolean(this.errorsTextSelection && this.errorsTextSelection.end > this.errorsTextSelection.start);
        this.errorsAddSpanBtn.disabled = !hasSelection;
        if (this.errorsSelectionHint) {
            this.errorsSelectionHint.classList.toggle("text-text-muted", hasSelection);
            this.errorsSelectionHint.classList.toggle("text-text-disabled", !hasSelection);
        }
    }

    getErrorSpansArray() {
        if (!Array.isArray(this.errorDetection.errorSpans)) {
            this.errorDetection.errorSpans = [];
        }
        const content = this.ensureTaskContentObject();
        if (content && !Array.isArray(content.error_spans)) {
            content.error_spans = this.errorDetection.errorSpans;
        }
        return this.errorDetection.errorSpans;
    }

    handleErrorsAddSpan() {
        if (!this.errorsTextSelection) return;
        const text = this.errorDetection.text || "";
        if (!text) return;
        const { start, end } = this.errorsTextSelection;
        if (end <= start) return;
        const spans = this.getErrorSpansArray();
        spans.push({
            start,
            end,
            label: null,
            is_correct: false
        });
        const content = this.ensureTaskContentObject();
        if (content) {
            content.error_spans = spans;
        }
        this.errorsTextSelection = null;
        this.renderErrorsSpanList();
        this.renderErrorsHighlightLayer();
        this.updateErrorsAddButtonState();
        this.updateErrorsTotalCount();
        this.markUnsaved();
    }

    handleErrorsDeleteSpan(index) {
        const spans = this.getErrorSpansArray();
        if (index < 0 || index >= spans.length) return;
        spans.splice(index, 1);
        this.renderErrorsSpanList();
        this.renderErrorsHighlightLayer();
        this.updateErrorsTotalCount();
        this.markUnsaved();
    }

    handleErrorsJumpToSpan(index) {
        const spans = this.getErrorSpansArray();
        if (index < 0 || index >= spans.length) return;
        const textarea = this.errorsTextEditor;
        if (!textarea) return;
        const text = textarea.value || "";
        const start = Math.max(0, Math.min(spans[index].start ?? 0, text.length));
        const end = Math.max(start, Math.min(spans[index].end ?? start, text.length));
        textarea.focus();
        textarea.setSelectionRange(start, end);
        this.handleErrorsTextSelection();
    }

    handleErrorsLabelInput(index, value) {
        const spans = this.getErrorSpansArray();
        if (index < 0 || index >= spans.length) return;
        const label = value?.trim() || null;
        if (spans[index].label === label) {
            return;
        }
        spans[index].label = label;
        this.markUnsaved();
    }

    async handleErrorsClearAll() {
        const spans = this.getErrorSpansArray();
        if (!spans.length) return;
        const confirmed = await this.confirmAction({
            title: "Очистить ошибки?",
            message: "Все отмеченные ошибки будут удалены.",
            confirmText: "Очистить",
            cancelText: "Отмена",
            variant: "error"
        });
        if (!confirmed) return;
        spans.splice(0, spans.length);
        this.errorsTextSelection = null;
        if (this.errorsTextEditor) {
            this.errorsTextEditor.setSelectionRange(0, 0);
        }
        this.renderErrorsSpanList();
        this.renderErrorsTextPreview();
        this.renderErrorsHighlightLayer();
        this.updateErrorsAddButtonState();
        this.updateErrorsTotalCount();
        this.refreshErrorsRequiredCorrectUI(true);
        this.markUnsaved();
    }

    sanitizeErrorSpansAgainstText() {
        const text = this.errorDetection.text || "";
        const len = text.length;
        const spans = this.getErrorSpansArray();
        let changed = false;
        for (let i = spans.length - 1; i >= 0; i -= 1) {
            const span = spans[i];
            const start = Math.max(0, Math.min(span.start ?? 0, len));
            const end = Math.max(start, Math.min(span.end ?? start, len));
            if (end <= start) {
                spans.splice(i, 1);
                changed = true;
                continue;
            }
            if (start !== span.start || end !== span.end) {
                span.start = start;
                span.end = end;
                changed = true;
            }
        }
        if (changed) {
            this.markUnsaved();
        }
        this.updateErrorsTotalCount();
    }

    handleErrorsRequiredCorrectInput() {
        if (!this.errorsRequiredCorrectInput) return;
        const spans = this.getErrorSpansArray();
        const total = Math.max(spans.length, 0);
        const minAllowed = total === 0 ? 0 : 1;
        let value = parseInt(this.errorsRequiredCorrectInput.value, 10);
        if (!Number.isFinite(value) || value < minAllowed) {
            value = minAllowed;
        } else if (value > total) {
            value = total;
        }
        this.errorsRequiredCorrectInput.value = String(value);
        this.errorDetection.requiredCorrectManual = value >= minAllowed;
        const previous = this.errorDetection.requiredCorrect;
        if (previous === value) {
            return;
        }
        this.errorDetection.requiredCorrect = value;
        const content = this.ensureTaskContentObject();
        if (content) {
            this.applyErrorsRequiredCorrectToContent(content);
        }
        this.refreshErrorsRequiredCorrectUI(true);
        this.markUnsaved();
    }

    renderErrorsTextPreview() {
        if (!this.errorsPaneInitialized || !this.errorsTextPreview) return;
        const text = this.errorDetection.text || "";
        if (!text) {
            this.errorsTextPreview.innerHTML = '<span class="text-text-disabled text-xs">Нет текста</span>';
            return;
        }
        const spans = [...this.getErrorSpansArray()].sort((a, b) => a.start - b.start);
        let cursor = 0;
        const len = text.length;
        const parts = [];

        const pushPlain = (segment) => {
            if (!segment) return;
            parts.push(`<span>${escapeHtml(segment)}</span>`);
        };

        spans.forEach((span, index) => {
            const start = Math.max(0, Math.min(span.start ?? 0, len));
            const end = Math.max(start, Math.min(span.end ?? start, len));
            if (end <= start) {
                return;
            }
            if (start > cursor) {
                pushPlain(text.slice(cursor, start));
            }
            const snippet = text.slice(start, end) || "";
            parts.push(
                `<span class="inline-flex items-center gap-1 bg-error-lighter text-error-text px-1.5 py-0.5 rounded border border-error-light cursor-pointer text-xs font-mono tracking-tight" data-errors-preview-span="${index}">${escapeHtml(snippet)}</span>`
            );
            cursor = end;
        });
        if (cursor < len) {
            pushPlain(text.slice(cursor));
        }
        this.errorsTextPreview.innerHTML = parts.join("");
    }

    renderErrorsSpanList() {
        if (!this.errorsPaneInitialized || !this.errorsSpanList || !this.errorsSpanEmptyState) return;
        const spans = this.getErrorSpansArray();
        if (!spans.length) {
            this.errorsSpanEmptyState.classList.remove("hidden");
            this.errorsSpanList.innerHTML = "";
            return;
        }
        this.errorsSpanEmptyState.classList.add("hidden");
        const text = this.errorDetection.text || "";
        const rows = spans
            .map((span, index) => {
                const start = span.start ?? 0;
                const end = span.end ?? start;
                const snippet = text.slice(start, end) || "";
                return `
                    <tr data-errors-span-row data-span-index="${index}">
                        <td class="px-4 py-3 text-xs font-semibold text-text-muted align-top">${index + 1}</td>
                        <td class="px-4 py-3 align-top">
                            <div class="text-sm font-mono bg-surface-2 rounded border border-dashed border-subtle px-2 py-1">
                                ${snippet ? escapeHtml(snippet) : '<span class="text-text-disabled">Пусто</span>'}
                            </div>
                            <div class="mt-2 text-xs text-text-muted">Диапазон: ${start}–${end}</div>
                        </td>
                        <td class="px-4 py-3 align-top">
                            <div class="flex flex-col gap-2 items-end">
                                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-primary border border-primary rounded-lg hover:bg-primary-lighter transition" data-action="jump-span">
                                    Перейти
                                </button>
                                <button type="button" class="px-3 py-1.5 text-xs font-semibold text-error border border-error-light rounded-lg hover:bg-error-lighter transition" data-action="delete-span">
                                    Удалить
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join("");
        this.errorsSpanList.innerHTML = rows;
        this.attachErrorsSpanListEvents();
    }

    attachErrorsSpanListEvents() {
        if (!this.errorsSpanList) return;
        this.errorsSpanList.querySelectorAll("[data-action='jump-span']").forEach((button) => {
            button.addEventListener("click", (event) => {
                const row = event.currentTarget.closest("[data-span-index]");
                const index = Number(row?.dataset?.spanIndex ?? "-1");
                this.handleErrorsJumpToSpan(index);
            });
        });
        this.errorsSpanList.querySelectorAll("[data-action='delete-span']").forEach((button) => {
            button.addEventListener("click", (event) => {
                const row = event.currentTarget.closest("[data-span-index]");
                const index = Number(row?.dataset?.spanIndex ?? "-1");
                this.handleErrorsDeleteSpan(index);
            });
        });
        this.errorsSpanList.querySelectorAll("[data-action='span-label']").forEach((input) => {
            input.addEventListener("input", (event) => {
                const target = event.currentTarget;
                const index = Number(target.dataset.spanIndex ?? "-1");
                this.handleErrorsLabelInput(index, target.value);
            });
        });
    }

    updateErrorsTotalCount() {
        if (!this.errorsPaneInitialized || !this.errorsTotalCountLabel) return;
        const spans = this.getErrorSpansArray();
        this.errorsTotalCountLabel.textContent = String(spans.length);
        this.syncErrorsRequiredCorrectWithTotal(spans.length);
    }

    setupModeSwitch() {
        if (!this.modeSwitch || !this.modeTextBtn || !this.modeErrorsBtn) return;

        // Активное состояние по умолчанию выбираем по состоянию задания
        const defaultMode = this.errorDetection.enabled ? "errors" : "text";
        console.log('[DEBUG] setupModeSwitch: defaultMode =', defaultMode, 'errorDetection.enabled =', this.errorDetection.enabled);
        // Don't await here - let it load async in background
        this.setModeToggleActive(defaultMode);

        // Переключение только если не заблокировано
        const onClick = (mode) => {
            if (this.modeSwitchDisabled) return;
            this.setModeToggleActive(mode);
        };

        this.modeTextBtn.addEventListener("click", () => onClick("text"));
        this.modeErrorsBtn.addEventListener("click", () => onClick("errors"));

        // Блокируем переключатель для сохранённых заданий (открытых из БД)
        // Признак: задача загружена с task_data и имеет id
        const isExistingTask = Boolean(this.task?.task_data?.id || this.task?.task_data?.task_id || this.task?.task_id || this.task?.id);
        const isMarkedNew = this.isNewTaskParam || this.task?.task_data?.is_new === true || this.task?.is_new === true;
        this.setModeToggleDisabled(isExistingTask && !isMarkedNew);
    }

    async setModeToggleActive(mode) {
        if (!this.modeTextBtn || !this.modeErrorsBtn) return;
        const activeClasses = "bg-surface-1 text-text-main shadow-sm";
        const inactiveClasses = "text-text-muted hover:text-text-secondary";

        const normalized = mode === "errors" ? "errors" : "text";
        if (normalized === "errors") {
            this.enableErrorDetectionEditor();
        }
        this.currentMode = normalized;

        if (mode === "errors") {
            this.modeErrorsBtn.classList.add(...activeClasses.split(" "));
            this.modeErrorsBtn.classList.remove(...inactiveClasses.split(" "));
            this.modeTextBtn.classList.add(...inactiveClasses.split(" "));
            this.modeTextBtn.classList.remove(...activeClasses.split(" "));
        } else {
            this.modeTextBtn.classList.add(...activeClasses.split(" "));
            this.modeTextBtn.classList.remove(...inactiveClasses.split(" "));
            this.modeErrorsBtn.classList.add(...inactiveClasses.split(" "));
            this.modeErrorsBtn.classList.remove(...activeClasses.split(" "));
        }

        await this.updateModePaneVisibility();
        this.updateSubtaskToggleVisibility();
    }

    setModeToggleDisabled(disabled) {
        const btns = [this.modeTextBtn, this.modeErrorsBtn].filter(Boolean);
        btns.forEach((btn) => {
            if (disabled) {
                btn.setAttribute("aria-disabled", "true");
                btn.setAttribute("title", "Переключатель доступен только при создании нового задания");
                btn.classList.add("opacity-60", "cursor-not-allowed");
            } else {
                btn.removeAttribute("aria-disabled");
                btn.removeAttribute("title");
                btn.classList.remove("opacity-60", "cursor-not-allowed");
            }
        });
    }

    async ensureErrorsPaneLoaded() {
        if (this.errorsPaneLoaded || !this.errorsModePane) return;
        const tpl = document.querySelector("#errors-mode-template");
        if (tpl) {
            this.errorsModePane.innerHTML = tpl.innerHTML;
            this.errorsPaneLoaded = true;
            this.initErrorsPaneComponents();
            this.updateErrorsSubpaneVisibility();
            return;
        }

        try {
            const candidates = [
                "../MistakesClickUI/Main.html",
                "./MistakesClickUI/Main.html",
                "MistakesClickUI/Main.html",
                "/Plan UI and Smth/MistakesClickUI/Main.html",
                "/Plan%20UI%20and%20Smth/MistakesClickUI/Main.html",
                "/MistakesClickUI/Main.html"
            ];

            let html = null;
            let lastError = null;

            for (const path of candidates) {
                try {
                    const response = await fetch(path);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    html = await response.text();
                    break;
                } catch (e) {
                    lastError = e;
                    continue;
                }
            }

            if (!html) {
                throw lastError || new Error("Failed to load errors UI");
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const main = doc.querySelector("main");
            const styleBlocks = Array.from(doc.querySelectorAll("style"));
            this.errorsModePane.innerHTML = main ? main.outerHTML : html;

            const inlineCss = styleBlocks.map((s) => s.textContent || "").join("\n").trim();
            if (inlineCss && !document.querySelector("#errors-mode-inline-styles")) {
                const styleEl = document.createElement("style");
                styleEl.id = "errors-mode-inline-styles";
                styleEl.textContent = inlineCss;
                document.head.appendChild(styleEl);
            }

            this.errorsPaneLoaded = true;
            this.initErrorsPaneComponents();
        } catch (error) {
            console.error("Failed to load errors UI:", error);
            this.errorsModePane.innerHTML =
                '<div class="p-6 text-sm text-error">Не удалось загрузить интерфейс «Ошибки».</div>';
        }
    }

    initSubtaskToggle() {
        if (!this.subtaskToggle || this.subtaskToggleInitialized) return;
        this.subtaskToggleButtons = Array.from(this.subtaskToggle.querySelectorAll(".subtask-toggle-btn"));
        if (!this.subtaskToggleButtons.length) return;

        this.subtaskToggleButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                this.handleSubtaskModeClick(btn.dataset.subtaskMode);
            });
        });

        this.subtaskToggleInitialized = true;
        this.syncSubtaskButtons();
        this.updateErrorsSubpaneVisibility();
    }

    updateSubtaskButtons() {
        if (!this.subtaskToggleButtons || !this.subtaskToggleButtons.length) return;
        const activeClasses = ["bg-surface-1", "text-text-main", "shadow-sm"];
        const inactiveClasses = ["text-text-muted", "hover:text-text-secondary"];
        this.subtaskToggleButtons.forEach((btn) => {
            const isActive = btn.dataset.subtaskMode === this.currentSubtaskMode;
            btn.classList.toggle("active", isActive);
            activeClasses.forEach((cls) => btn.classList.toggle(cls, isActive));
            inactiveClasses.forEach((cls) => btn.classList.toggle(cls, !isActive));
        });
    }

    updateErrorsSubpaneVisibility() {
        if (!this.errorsModePane) return;
        const subpanes = Array.from(this.errorsModePane.querySelectorAll("[data-errors-subpane]"));
        if (!subpanes.length) return;
        subpanes.forEach((pane) => {
            const shouldShow = pane.dataset.errorsSubpane === this.currentSubtaskMode;
            pane.classList.toggle("hidden", !shouldShow);
        });
    }

    async updateModePaneVisibility() {
        const isErrors = this.currentMode === "errors";
        console.log('[DEBUG] updateModePaneVisibility: currentMode =', this.currentMode, 'isErrors =', isErrors);
        if (isErrors) {
            console.log('[DEBUG] Loading errors pane...');
            await this.ensureErrorsPaneLoaded();
            this.currentSubtaskMode = this.getSubpaneKeyForMode(this.errorDetection.mode);
            this.updateSubtaskButtons();
            this.updateErrorsSubpaneVisibility();
        }
        if (this.clickModePane) {
            console.log('[DEBUG] Setting clickModePane hidden =', isErrors);
            this.clickModePane.classList.toggle("hidden", isErrors);
        }
        if (this.errorsModePane) {
            console.log('[DEBUG] Setting errorsModePane hidden =', !isErrors);
            this.errorsModePane.classList.toggle("hidden", !isErrors);
        }
        this.updateSubtaskToggleVisibility();
    }

    updateSubtaskToggleVisibility() {
        if (!this.subtaskToggle) return;
        const shouldShow = this.currentMode === "errors" && this.errorDetection.enabled;
        this.subtaskToggle.classList.toggle("hidden", !shouldShow);
        if (shouldShow) {
            this.initSubtaskToggle();
        } else {
            this.currentSubtaskMode = this.getSubpaneKeyForMode("text_errors");
        }
        this.updateErrorsSubpaneVisibility();
    }

    getSubpaneKeyForMode(mode) {
        return mode === "text_choice" ? "errors" : "text";
    }

    getModeForSubpane(subpaneKey) {
        return subpaneKey === "errors" ? "text_choice" : "text_errors";
    }

    handleSubtaskModeClick(subpaneKey) {
        if (!this.errorDetection.enabled) {
            return;
        }
        const normalizedKey = subpaneKey === "errors" ? "errors" : "text";
        if (this.currentSubtaskMode === normalizedKey) {
            return;
        }
        const nextMode = this.getModeForSubpane(normalizedKey);
        const content = this.ensureTaskContentObject();
        if (!content) return;

        this.currentSubtaskMode = normalizedKey;
        this.errorDetection.mode = nextMode;
        content.mode = nextMode;

        if (nextMode === "text_choice" && !Array.isArray(content.options)) {
            content.options = [];
            this.errorDetection.options = content.options;
        } else if (nextMode === "text_errors" && !Array.isArray(content.error_spans)) {
            content.error_spans = [];
            this.errorDetection.errorSpans = content.error_spans;
        }

        this.updateSubtaskButtons();
        this.updateErrorsSubpaneVisibility();
        this.markUnsaved();
    }

    syncSubtaskButtons() {
        this.currentSubtaskMode = this.getSubpaneKeyForMode(this.errorDetection.mode);
        this.updateSubtaskButtons();
    }

    extractAnnotationsFromContent() {
        const content = this.task?.task_data?.content || {};
        const annotations = Array.isArray(content.annotations) ? content.annotations : [];
        if (annotations.length) {
            return annotations;
        }
        const regions = this.convertLegacyRegionsToAnnotations(content.regions);
        if (regions.length && this.task?.task_data?.content) {
            this.task.task_data.content.annotations = regions;
        }
        return regions;
    }

    convertLegacyRegionsToAnnotations(regions) {
        if (!Array.isArray(regions)) return [];
        return regions
            .map((region, index) => {
                if (!region) return null;
                const rawPoints = Array.isArray(region.points) ? region.points : [];
                const sanitizedPoints = rawPoints
                    .map((point) => {
                        if (Array.isArray(point) && point.length >= 2) {
                            const [x, y] = point;
                            const fx = Number(x);
                            const fy = Number(y);
                            if (Number.isFinite(fx) && Number.isFinite(fy)) {
                                return [fx, fy];
                            }
                        } else if (point && typeof point === "object") {
                            const fx = Number(point.x);
                            const fy = Number(point.y);
                            if (Number.isFinite(fx) && Number.isFinite(fy)) {
                                return [fx, fy];
                            }
                        }
                        return null;
                    })
                    .filter(Boolean);
                if (sanitizedPoints.length < 3) return null;
                return {
                    type: "polygon",
                    label: region.label || region.name || `Область ${index + 1}`,
                    points: sanitizedPoints,
                    color: region.color,
                    hidden: region.hidden ?? false
                };
            })
            .filter(Boolean);
    }

    normalizeAnnotations(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList
            .filter(Boolean)
            .map((ann, index) => {
                const annType = ann.type || "polygon";
                if (!["polygon", "freehand"].includes(annType) || !Array.isArray(ann.points)) {
                    return null;
                }
                const sanitizedPoints = ann.points
                    .map((point) => {
                        const [x, y] = point;
                        const nx = Number.isFinite(Number(point?.x)) ? Number(point.x) : Number(x);
                        const ny = Number.isFinite(Number(point?.y)) ? Number(point.y) : Number(y);
                        const fx = Number(nx);
                        const fy = Number(ny);
                        if (Number.isFinite(fx) && Number.isFinite(fy)) {
                            return [fx, fy];
                        }
                        return null;
                    })
                    .filter(Boolean);
                const minPoints = annType === "polygon" ? 3 : 2;
                if (sanitizedPoints.length < minPoints) return null;

                const color = ann.color || this.pickColor(index);
                return {
                    type: annType,
                    label: ann.label || (annType === "freehand" ? `Линия ${index + 1}` : `Область ${index + 1}`),
                    points: sanitizedPoints,
                    color,
                    hidden: ann.hidden ?? false,
                    labelVisible: Boolean(ann.labelVisible)
                };
            })
            .filter(Boolean);
    }

    renderUI() {
        if (!this.task) return;
        
        const content = this.task.task_data?.content || {};

        if (this.modeSwitch) {
            this.modeSwitch.classList.toggle("hidden", this.isDrawTask);
        }

        if (this.headerTitle) {
            const humanName =
                this.task.task_data?.name ||
                this.task.task_data?.title ||
                this.task.task_data?.meta?.title ||
                this.task.metadata?.title ||
                this.task.metadata?.name ||
                this.task.metadata?.id ||
                "Задание";
            this.headerTitle.textContent = `Редактирование задания: ${humanName}`;
        }

        if (this.promptArea) {
            const savedPrompt = this.task.task_data?.content?.prompt || "";
            this.promptArea.value = savedPrompt || "";
        }
        if (this.choicePromptTextarea) {
            const choicePrompt = this.task.task_data?.content?.choice_prompt || this.task.task_data?.content?.prompt || "";
            this.choicePromptTextarea.value = choicePrompt || "";
        }

        if (this.requiredCorrectInput) {
            const content = this.task.task_data?.content || {};
            const settings = this.task.task_data?.settings || {};
            const rawThreshold = Number(settings.success_threshold);
            const fallbackThreshold = Number(content.required_correct);
            const resolvedThreshold =
                Number.isFinite(rawThreshold) && rawThreshold >= 1
                    ? rawThreshold
                    : (Number.isFinite(fallbackThreshold) && fallbackThreshold >= 1 ? fallbackThreshold : 1);
            this.requiredCorrectInput.value = resolvedThreshold;
            this.enforceRequiredCorrectBounds({ clampToMax: true });
        }
        this.initAdditionalInfoToggle();
        this.renderAdditionalInfo();

        const imageRef = this.task.task_data?.content?.image;
        const imageSrc = this.resolveEditorImagePreviewSrc(imageRef);
        if (imageSrc && this.img) {
            this.imagePlaceholder?.classList.add("hidden");
            this.img.classList.remove("hidden");
            this.img.onload = () => {
                this.captureBaseImageMetrics({ forceBase: true });
                this.resetViewport();
                this.renderAnnotations();
            };
            this.img.onerror = () => this.handleImageError();
            this.img.src = imageSrc;
        } else if (this.img) {
            this.img.classList.add("hidden");
            this.imagePlaceholder?.classList.remove("hidden");
            this.resetImageMetrics();
            this.applyEmptyCanvasStageSize();
            this.resetViewport();
            this.renderAnnotations();
        }

        if (!this.additionalInfoDirty) {
            this.additionalInfo = this.normalizeAdditionalInfo(this.task.task_data?.content?.additionalInfo);
        }
        this.renderAnnotationList();
        this.updateAnnotationCount();
        this.updateDrawingControlsState();
        this.renderAdditionalInfo();
        this.updateSaveStatus(this.hasUnsavedChanges);
        this.updateLabelVisibilityUI();
        
        // Ensure correct pane is visible based on currentMode set by setupModeSwitch
        // This is async but won't block rendering
        this.updateModePaneVisibility();
    }

    setupEventListeners() {
        this.initToolbarTooltips();

        if (this.previewBtn) {
            this.previewBtn.addEventListener("click", () => {
                this.goBack();
            });
        }

        if (this.canvasContainer) {
            this.canvasContainer.addEventListener("click", (event) => {
                const before = this.captureTaskSnapshot();
                this.handleCanvasClick(event);
                this.handlePotentialChange(before);
            });
            this.canvasContainer.addEventListener("dblclick", (event) => {
                event.preventDefault();
                if (this.currentTool === "polygon") {
                    this.finishCurrentPolygon();
                }
            });
            this.canvasContainer.addEventListener("wheel", (event) => this.handleCanvasWheel(event), { passive: false });
            this.canvasContainer.addEventListener("mousedown", (event) => {
                const before = this.captureTaskSnapshot();
                this.handleCanvasMouseDown(event);
                this.handlePotentialChange(before);
            });
        }

        if (this.overlay) {
            this.overlay.addEventListener("mousedown", (event) => {
                const before = this.captureTaskSnapshot();
                this.handleOverlayMouseDown(event);
                this.handlePotentialChange(before);
            });
        }

        if (this.labelToggleBtn) {
            this.labelToggleBtn.addEventListener("click", () => {
                this.cycleLabelDisplayMode();
            });
        }

        window.addEventListener("mousemove", (event) => {
            const before = this.captureTaskSnapshot();
            this.handleCanvasMouseMove(event);
            this.handlePotentialChange(before, { skipIfSame: true });
        });
        window.addEventListener("mouseup", (event) => {
            const before = this.captureTaskSnapshot();
            this.handleCanvasMouseUp(event);
            this.handlePotentialChange(before);
        });

        if (this.finishBtn) {
            this.finishBtn.addEventListener("click", () => this.finishCurrentPolygon());
        }
        if (this.deleteLastPointBtn) {
            this.deleteLastPointBtn.addEventListener("click", () => this.handleDeletePointAction());
        }
        if (this.cancelPolygonBtn) {
            this.cancelPolygonBtn.addEventListener("click", () => this.cancelPolygonDrawing());
        }
        if (this.clearAnnotationsBtn) {
            this.clearAnnotationsBtn.addEventListener("click", () => this.clearAnnotations());
        }

        this.toolToggleButtons.forEach((button) => {
            button.addEventListener("click", () => {
                const { tool } = button.dataset;
                if (tool) {
                    this.setTool(tool);
                }
            });
        });

        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener("click", () => this.adjustZoom(1));
        }
        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener("click", () => this.adjustZoom(-1));
        }

        if (this.publishBtn) {
            this.publishBtn.addEventListener("click", () => this.saveTask());
        }
        if (this.additionalTypeSelect) {
            this.additionalTypeSelect.addEventListener("change", (event) => this.handleAdditionalTypeChange(event));
        }
        if (this.additionalTextArea) {
            this.additionalTextArea.addEventListener("input", (event) => this.handleAdditionalTextInput(event));
        }
        if (this.additionalAddImageBtn) {
            this.additionalAddImageBtn.addEventListener("click", () => this.handleAdditionalAddImage());
        }
        if (this.additionalImageInput) {
            this.additionalImageInput.addEventListener("change", (event) => this.handleAdditionalImageUpload(event));
        }
        if (this.imagePreviewClose) {
            this.imagePreviewClose.addEventListener("click", () => this.hideImagePreview());
        }
        if (this.imagePreviewModal) {
            this.imagePreviewModal.addEventListener("click", (event) => {
                if (event.target === this.imagePreviewModal) {
                    this.hideImagePreview();
                }
            });
        }
        if (this.changeImageBtn && this.imageUploadInput) {
            this.changeImageBtn.addEventListener("click", () => this.imageUploadInput.click());
            this.imageUploadInput.addEventListener("change", (event) => this.handleMainImageUpload(event));
        }

        if (this.promptArea) {
            this.promptArea.addEventListener("input", () => {
                this.markUnsaved();
                this.updateErrorsPromptPreview();
                this.updateChoicePromptPreview();
            });
        }
        if (this.choicePromptTextarea) {
            this.choicePromptTextarea.addEventListener("input", () => {
                this.markUnsaved();
                this.updateChoicePromptPreview();
            });
        }
        this.initPromptToggle();
        this.initChoicePromptToggle();
        if (this.requiredCorrectInput) {
            const handleRequiredCorrectInput = () => {
                this.enforceRequiredCorrectBounds({ clampToMax: true });
                this.markUnsaved();
            };
            this.requiredCorrectInput.addEventListener("input", handleRequiredCorrectInput);
            this.requiredCorrectInput.addEventListener("blur", () => this.enforceRequiredCorrectBounds({ clampToMax: true }));
        }

        window.addEventListener("resize", () => {
            this.hasCenteredImage = false;
            if (this.img && !this.img.classList.contains("hidden")) {
                this.recalculateImageMetrics(true);
            } else {
                this.resetImageMetrics();
                this.applyEmptyCanvasStageSize();
                this.resetViewport();
            }
            this.renderAnnotations();
        });

        window.addEventListener("keydown", (event) => this.handleKeyDown(event));

        this.updateStatusBadge("Режим ожидания");

        this.updateToolButtons();
        this.updateCursorState();
    }

    initPromptToggle() {
        if (this.promptToggleInitialized) return;
        if (!this.promptToggleBtn || !this.promptAreaWrapper) return;
        let open = false;
        const icon = this.promptToggleBtn.querySelector("[data-prompt-icon]");
        const label = this.promptToggleBtn.querySelector("[data-prompt-label]");
        const update = () => {
            this.promptAreaWrapper.classList.toggle("hidden", !open);
            if (label) label.textContent = open ? "Скрыть" : "Показать";
            if (icon) icon.textContent = open ? "expand_less" : "expand_more";
        };
        this.promptToggleBtn.addEventListener("click", () => {
            open = !open;
            update();
        });
        update();
        this.promptToggleInitialized = true;
    }

    initChoicePromptToggle() {
        if (this.choicePromptToggleInitialized) return;
        if (!this.choicePromptToggleBtn || !this.choicePromptAreaWrapper) return;
        let open = false;
        const icon = this.choicePromptToggleBtn.querySelector("[data-choice-prompt-icon]");
        const label = this.choicePromptToggleBtn.querySelector("[data-choice-prompt-label]");
        const update = () => {
            this.choicePromptAreaWrapper.classList.toggle("hidden", !open);
            if (label) label.textContent = open ? "Скрыть" : "Показать";
            if (icon) icon.textContent = open ? "expand_less" : "expand_more";
        };
        this.choicePromptToggleBtn.addEventListener("click", () => {
            open = !open;
            update();
        });
        update();
        this.choicePromptToggleInitialized = true;
    }

    updateAdditionalInfoToggleUi() {
        if (this.additionalInfoContent) {
            this.additionalInfoContent.classList.toggle("hidden", !this.additionalInfoSectionOpen);
        }
        if (this.additionalInfoToggleIcon) {
            this.additionalInfoToggleIcon.textContent = this.additionalInfoSectionOpen ? "expand_less" : "expand_more";
        }
        if (this.additionalInfoToggleBtn) {
            this.additionalInfoToggleBtn.setAttribute("aria-expanded", this.additionalInfoSectionOpen ? "true" : "false");
        }
    }

    initAdditionalInfoToggle() {
        if (!this.additionalInfoToggleBtn || !this.additionalInfoContent) return;
        if (!this.additionalInfoToggleInitialized) {
            this.additionalInfoToggleBtn.addEventListener("click", () => {
                this.additionalInfoSectionOpen = !this.additionalInfoSectionOpen;
                this.updateAdditionalInfoToggleUi();
            });
            this.additionalInfoToggleInitialized = true;
        }
        this.updateAdditionalInfoToggleUi();
    }

    loadLabelDisplayMode() {
        try {
            const stored = localStorage.getItem("click_editor_label_mode");
            if (LABEL_DISPLAY_MODES.includes(stored)) {
                return stored;
            }
        } catch (error) {
            console.warn("Failed to load label display mode:", error);
        }
        return LABEL_DISPLAY_MODES[0];
    }

    saveLabelDisplayMode(mode) {
        try {
            localStorage.setItem("click_editor_label_mode", mode);
        } catch (error) {
            console.warn("Failed to save label display mode:", error);
        }
    }

    cycleLabelDisplayMode() {
        const currentIndex = LABEL_DISPLAY_MODES.indexOf(this.labelDisplayMode);
        const nextIndex = (currentIndex + 1) % LABEL_DISPLAY_MODES.length;
        this.labelDisplayMode = LABEL_DISPLAY_MODES[nextIndex];
        this.saveLabelDisplayMode(this.labelDisplayMode);
        this.updateLabelVisibilityUI();
        this.renderAnnotations();
    }

    updateLabelVisibilityUI() {
        if (!this.labelToggleText) {
            return;
        }
        const modeTitleMap = {
            compact: "Компактно",
            off: "Выкл"
        };
        const iconMap = {
            compact: "visibility",
            off: "visibility_off"
        };
        const mode = LABEL_DISPLAY_MODES.includes(this.labelDisplayMode) ? this.labelDisplayMode : LABEL_DISPLAY_MODES[0];
        this.labelToggleText.textContent = modeTitleMap[mode] || "Компактно";
        if (this.labelToggleBtn) {
            const icon = this.labelToggleBtn.querySelector(".material-symbols-outlined");
            if (icon) {
                icon.textContent = iconMap[mode] || "visibility";
            }
            this.labelToggleBtn.setAttribute("data-label-mode", mode);
        }
    }

    getBaseLabelFontSize() {
        if (this.helpers?.getBaseLabelFontSize) {
            return this.helpers.getBaseLabelFontSize(1, { baseFontSize: 12 });
        }
        return 12;
    }

    getLabelScaleFactor() {
        if (this.helpers?.getLabelScaleFactor) {
            return this.helpers.getLabelScaleFactor(1);
        }
        return 1;
    }

    getLabelMaxWidth(canvasWidth) {
        if (this.helpers?.getLabelMaxWidth) {
            return this.helpers.getLabelMaxWidth(canvasWidth, { zoomLevel: 1 });
        }
        const safeWidth = Math.max(canvasWidth || 0, 160);
        return Math.max(120, Math.min(220, safeWidth - 40));
    }

    shouldRenderLabel(annotation, index) {
        if (annotation?.labelVisible) {
            return true;
        }
        const mode = LABEL_DISPLAY_MODES.includes(this.labelDisplayMode) ? this.labelDisplayMode : LABEL_DISPLAY_MODES[0];
        if (mode === "off") {
            return false;
        }
        if (this.helpers?.shouldRenderLabelWithContext) {
            const bounds = annotation?.boundingBox || this.getAnnotationBounds(annotation);
            const thresholds = mode === "compact" ? { minZoom: 0.4, minSize: 10 } : undefined;
            return this.helpers.shouldRenderLabelWithContext({
                mode: "all",
                zoomLevel: this.zoomLevel,
                bounds,
                annotationType: annotation?.type || "polygon",
                forceVisible: index === this.selectedAnnotationIndex,
                thresholds
            });
        }
        return Boolean(annotation?.label);
    }

    getAnnotationBounds(annotation) {
        const points = annotation?.points;
        if (!Array.isArray(points) || !points.length) {
            return null;
        }
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            width: maxX - minX,
            height: maxY - minY
        };
    }

    setTool(tool) {
        if (!["polygon", "freehand"].includes(tool)) return;
        if (this.currentTool === tool) return;
        this.currentTool = tool;
        this.cancelPolygonDrawing();
        this.cancelFreehandDrawing();
        this.updateToolButtons();
        this.updateCursorState();
        this.updateDrawingControlsState();
        this.updateStatusBadge(
            tool === "polygon" ? "Режим: прямолинейное лассо" : "Режим: линии и линейные контуры"
        );
    }

    updateToolButtons() {
        if (!this.toolToggleButtons?.length) return;
        this.toolToggleButtons.forEach((button) => {
            const isActive = button.dataset.tool === this.currentTool;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
    }

    updateCursorState() {
        if (!this.canvasContainer) return;
        const crosshair = !this.isMiddlePanning && ["polygon", "freehand"].includes(this.currentTool);
        this.canvasContainer.classList.toggle("drawing-crosshair", crosshair);
        this.canvasContainer.classList.toggle("grabbing", this.isMiddlePanning);
    }

    validateTask() {
        if (!this.annotations || this.annotations.length === 0) {
            return "Необходимо добавить хотя бы одну область или линию";
        }
        for (let i = 0; i < this.annotations.length; i++) {
            const label = (this.annotations[i].label || "").trim();
            if (!label) {
                return `У объекта #${i + 1} отсутствует подпись. Пожалуйста, укажите её в списке справа.`;
            }
        }
        return null;
    }

    logScaleEvent(event, payload = {}) {
        const timestamp = new Date().toISOString();
        const entry = {
            event,
            zoom: Number(this.zoomLevel?.toFixed?.(4) ?? this.zoomLevel),
            panX: Number(this.panX?.toFixed?.(2) ?? this.panX),
            panY: Number(this.panY?.toFixed?.(2) ?? this.panY),
            payload,
            timestamp
        };
        this.debugLogBuffer.push(entry);
        if (this.debugLogBuffer.length > 200) {
            this.debugLogBuffer.shift();
        }
        if (typeof window !== "undefined") {
            window.__CLICK_EDITOR_DEBUG__ = window.__CLICK_EDITOR_DEBUG__ || [];
            window.__CLICK_EDITOR_DEBUG__.push(entry);
        }
        if (console?.debug) {
            console.debug("[ClickEditor]", event, entry);
        }
    }

    async exportScaleLog() {
        console.warn("exportScaleLog is deprecated and should not be called.");
    }

    isOverlayInteractiveTarget(element) {
        if (!element) return false;
        return Boolean(
            element.closest(".vertex-handle") ||
            element.closest(".annotation-shape") ||
            element.closest(".annotation-label")
        );
    }

    handleOverlayMouseDown(event) {
        if (event.button !== 0) return;
        const vertexTarget = event.target.closest(".vertex-handle");
        if (vertexTarget) {
            event.preventDefault();
            const annotationIndex = Number(vertexTarget.dataset.annotationIndex ?? -1);
            const vertexIndex = Number(vertexTarget.dataset.vertexIndex ?? -1);
            if (annotationIndex >= 0 && vertexIndex >= 0) {
                this.selectAnnotation(annotationIndex, { preserveVertex: true });
                this.selectVertex(annotationIndex, vertexIndex);
                this.draggingVertex = { annotationIndex, vertexIndex };
                this.vertexDragMoved = false;
            }
            return;
        }

        const annotationTarget = event.target.closest(".annotation-shape, .annotation-label");
        if (annotationTarget) {
            event.preventDefault();
            const annotationIndex = Number(annotationTarget.dataset.annotationIndex ?? -1);
            if (annotationIndex >= 0) {
                this.selectAnnotation(annotationIndex);
            }
        }
    }

    handleCanvasClick(event) {
        if (this.suppressNextClick) {
            this.suppressNextClick = false;
            return;
        }
        if (this.isOverlayInteractiveTarget(event.target)) {
            return;
        }
        if (!this.img || this.img.classList.contains("hidden")) return;
        if (this.currentTool !== "polygon" || event.button !== 0) return;

        const coords = this.clientToNatural(event.clientX, event.clientY);
        if (!coords) return;

        if (!this.drawingPolygon) {
            this.startPolygon();
        }

        this.currentPolygonPoints.push(coords);
        this.updateDrawingControlsState();
        this.updateStatusBadge(this.getPolygonProgressMessage(), { tone: "info" });
        this.renderAnnotations();
    }

    handleCanvasMouseDown(event) {
        if (!this.canvasContainer || !this.img || this.img.classList.contains("hidden")) return;
        if (this.isOverlayInteractiveTarget(event.target)) return;

        if (event.button === 1) {
            event.preventDefault();
            this.isMiddlePanning = true;
            this.middlePanStart = {
                x: event.clientX,
                y: event.clientY,
                panX: this.panX,
                panY: this.panY
            };
            this.updateCursorState();
            return;
        }

        if (event.button === 0 && this.currentTool === "freehand") {
            const coords = this.clientToNatural(event.clientX, event.clientY);
            if (!coords) return;
            event.preventDefault();
            this.isFreehandMouseDown = true;
            this.startFreehandDrawing(coords);
        }
    }

    handleCanvasMouseMove(event) {
        if (this.isMiddlePanning && this.middlePanStart) {
            event.preventDefault();
            const dx = event.clientX - this.middlePanStart.x;
            const dy = event.clientY - this.middlePanStart.y;
            this.panX = this.middlePanStart.panX + dx;
            this.panY = this.middlePanStart.panY + dy;
            this.updateStageTransform();
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                this.suppressNextClick = true;
            }
            return;
        }

        if (this.draggingVertex) {
            event.preventDefault();
            const coords = this.clientToNatural(event.clientX, event.clientY);
            if (!coords) return;
            const { annotationIndex, vertexIndex } = this.draggingVertex;
            const annotation = this.annotations[annotationIndex];
            if (!annotation || !annotation.points[vertexIndex]) return;
            annotation.points[vertexIndex] = coords;
            this.vertexDragMoved = true;
            this.renderAnnotations();
            return;
        }

        if (this.isFreehandMouseDown && this.currentTool === "freehand" && this.drawingFreehand) {
            const coords = this.clientToNatural(event.clientX, event.clientY);
            if (coords) {
                this.addFreehandPoint(coords);
            }
        }
    }

    handleCanvasMouseUp(event) {
        if (event.button === 1 && this.isMiddlePanning) {
            this.isMiddlePanning = false;
            this.middlePanStart = null;
            this.updateCursorState();
        }

        if (event.button === 0 && this.currentTool === "freehand") {
            if (this.isFreehandMouseDown && this.drawingFreehand) {
                this.finishFreehandDrawing();
            }
            this.isFreehandMouseDown = false;
        }

        if (event.button === 0 && this.draggingVertex) {
            if (this.vertexDragMoved) {
                this.renderAnnotationList();
            }
            this.draggingVertex = null;
            this.vertexDragMoved = false;
        }
    }

    handleKeyDown(event) {
        const tagName = event.target?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || tagName === "select" || event.target?.isContentEditable) {
            return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            this.handleDeletePointAction();
        }
    }

    startPolygon() {
        this.drawingPolygon = true;
        this.currentPolygonPoints = [];
        this.selectedAnnotationIndex = -1;
        this.resetVertexEditingState();
        this.updateDrawingControlsState();
        this.updateStatusBadge(this.getPolygonProgressMessage(), { tone: "info" });
    }

    removeLastPoint() {
        if (!this.currentPolygonPoints.length) return;
        this.currentPolygonPoints.pop();
        if (!this.currentPolygonPoints.length) {
            this.updateStatusBadge("Контур очищен, начните заново.", { tone: "warning" });
        } else {
            this.updateStatusBadge(this.getPolygonProgressMessage(), { tone: "info" });
        }
        this.updateDrawingControlsState();
        this.renderAnnotations();
    }

    getPolygonProgressMessage() {
        const pointsCount = this.currentPolygonPoints.length;
        if (pointsCount <= 0) {
            return "Поставьте минимум 3 точки, чтобы замкнуть контур.";
        }
        if (pointsCount < 3) {
            return `Точек: ${pointsCount} из 3. Добавьте ещё ${3 - pointsCount}.`;
        }
        return `Контур готов. Нажмите «Завершить контур» или сделайте двойной клик.`;
    }

    cloneAnnotation(annotation) {
        if (!annotation || typeof annotation !== "object") return null;
        try {
            return JSON.parse(JSON.stringify(annotation));
        } catch (error) {
            console.warn("[ClickEditor] Failed to clone annotation", error);
            return null;
        }
    }

    queueDeletedAnnotationUndo(annotation, index) {
        const annotationCopy = this.cloneAnnotation(annotation);
        if (!annotationCopy) return;

        this.pendingDeletedAnnotationUndo = {
            annotation: annotationCopy,
            index: Number.isInteger(index) ? index : this.annotations.length
        };

        const kindLabel = annotationCopy.type === "freehand" ? "Линия" : "Контур";
        const customLabel = String(annotationCopy.label || "").trim();
        const message = customLabel
            ? `${kindLabel} «${customLabel}» удалён.`
            : `${kindLabel} удалён.`;

        this.showToast(message, "warning", 5000, {
            actionLabel: "Отменить",
            onAction: () => this.restoreDeletedAnnotation(),
            onDismiss: () => {
                this.pendingDeletedAnnotationUndo = null;
            }
        });
    }

    restoreDeletedAnnotation() {
        if (!this.pendingDeletedAnnotationUndo) {
            return false;
        }

        const { annotation, index } = this.pendingDeletedAnnotationUndo;
        this.pendingDeletedAnnotationUndo = null;

        const restoreIndex = Math.max(0, Math.min(index, this.annotations.length));
        this.annotations.splice(restoreIndex, 0, annotation);

        if (this.selectedAnnotationIndex >= restoreIndex) {
            this.selectedAnnotationIndex += 1;
        }
        if (this.selectedVertex && this.selectedVertex.annotationIndex >= restoreIndex) {
            this.selectedVertex = {
                ...this.selectedVertex,
                annotationIndex: this.selectedVertex.annotationIndex + 1
            };
        }

        this.renderAnnotations();
        this.renderAnnotationList();
        this.updateAnnotationCount();
        this.enforceRequiredCorrectBounds({ clampToMax: true });
        this.updateDrawingControlsState();
        this.highlightAnnotation(restoreIndex);
        this.updateStatusBadge("Контур восстановлен.", { tone: "success" });
        this.markUnsaved();
        return true;
    }

    deleteAnnotation(annotationIndex, options = {}) {
        const index = Number(annotationIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.annotations.length) {
            return false;
        }

        const { skipStatus = false, allowUndo = true } = options;
        const removedAnnotation = this.annotations[index];
        this.annotations.splice(index, 1);
        this.clearHighlightForAnnotation(removedAnnotation, { silent: true });

        if (this.selectedAnnotationIndex === index) {
            this.selectedAnnotationIndex = -1;
        } else if (this.selectedAnnotationIndex > index) {
            this.selectedAnnotationIndex -= 1;
        }

        if (this.selectedVertex) {
            if (this.selectedVertex.annotationIndex === index) {
                this.resetVertexEditingState();
            } else if (this.selectedVertex.annotationIndex > index) {
                this.selectedVertex = {
                    ...this.selectedVertex,
                    annotationIndex: this.selectedVertex.annotationIndex - 1
                };
            }
        }

        this.renderAnnotations();
        this.renderAnnotationList();
        this.updateAnnotationCount();
        const requiredCorrectMeta = this.enforceRequiredCorrectBounds({ clampToMax: true });
        this.updateDrawingControlsState();
        this.markUnsaved();

        if (allowUndo) {
            this.queueDeletedAnnotationUndo(removedAnnotation, index);
        }

        if (!skipStatus) {
            const kindLabel = removedAnnotation?.type === "freehand" ? "Линия" : "Контур";
            const customLabel = String(removedAnnotation?.label || "").trim();
            const statusMessage = customLabel ? `${kindLabel} «${customLabel}» удалён.` : `${kindLabel} удалён.`;
            this.updateStatusBadge(
                customLabel ? `${kindLabel} «${customLabel}» удалён.` : `${kindLabel} удалён.`,
                { tone: "warning" }
            );
            if (requiredCorrectMeta?.autoLowered) {
                this.updateStatusBadge(
                    `${statusMessage} Порог снижен до ${requiredCorrectMeta.value} из ${this.formatContourCount(requiredCorrectMeta.annotationsCount)}.`,
                    { tone: "warning" }
                );
            }
        }

        return true;
    }

    handleDeletePointAction() {
        if (this.selectedVertex) {
            const { annotationIndex, vertexIndex } = this.selectedVertex;
            const annotation = this.annotations[annotationIndex];
            if (!annotation) {
                this.resetVertexEditingState();
                this.updateDrawingControlsState();
                return;
            }
            const minPoints = annotation.type === "polygon" ? 3 : 2;
            if (annotation.points.length <= minPoints) {
                this.updateStatusBadge(
                    `В ${annotation.type === "polygon" ? "контуре" : "линии"} должно оставаться минимум ${minPoints} точ${minPoints === 3 ? "ки" : "ки"
                    }.`,
                    { tone: "warning" }
                );
                return;
            }
            annotation.points.splice(vertexIndex, 1);
            if (!annotation.points.length) {
                this.deleteAnnotation(annotationIndex, { skipStatus: true });
                this.updateStatusBadge("Контур удалён.", { tone: "warning" });
                return;
            }
            const nextVertexIndex = Math.min(vertexIndex, annotation.points.length - 1);
            this.selectedVertex =
                annotation.points.length > 0 ? { annotationIndex, vertexIndex: nextVertexIndex } : null;
            this.renderAnnotations();
            this.renderAnnotationList();
            this.updateStatusBadge(`Точка удалена. Осталось ${annotation.points.length} точек.`, { tone: "info" });
            this.updateDrawingControlsState();
            return;
        }

        if (this.currentTool === "polygon" && this.currentPolygonPoints.length) {
            this.removeLastPoint();
        }
    }

    cancelPolygonDrawing() {
        this.drawingPolygon = false;
        this.currentPolygonPoints = [];
        this.resetVertexEditingState();
        this.updateDrawingControlsState();
        this.updateStatusBadge("Режим ожидания");
        this.renderAnnotations();
    }

    finishCurrentPolygon() {
        if (!this.drawingPolygon || this.currentPolygonPoints.length < 3) {
            return;
        }

        const polygon = {
            type: "polygon",
            label: this.generateAnnotationLabel("Контур", "polygon"),
            points: this.currentPolygonPoints.map(([x, y]) => [
                Number(x.toFixed(2)),
                Number(y.toFixed(2))
            ]),
            color: this.pickColor(this.annotations.length),
            labelVisible: false
        };

        this.annotations.push(polygon);
        this.drawingPolygon = false;
        this.currentPolygonPoints = [];
        this.updateAnnotationCount();
        this.updateDrawingControlsState();
        this.updateStatusBadge("Контур добавлен. Выберите следующий участок или сохраните задачу.", { tone: "success" });
        this.renderAnnotations();
        this.renderAnnotationList();
        this.enforceRequiredCorrectBounds({ clampToMax: true });
        this.markUnsaved();
    }

    pickColor(index) {
        return this.palette[index % this.palette.length];
    }

    generateAnnotationLabel(prefix, type) {
        const existing = this.annotations.filter((ann) => ann.type === type).length;
        return `${prefix} ${existing + 1}`;
    }

    startFreehandDrawing(startCoords) {
        this.drawingFreehand = true;
        this.freehandPoints = [startCoords];
        this.selectedAnnotationIndex = -1;
        this.resetVertexEditingState();
        this.updateStatusBadge("Ведите мышь, зажав ЛКМ, чтобы провести линию или линейный контур.", { tone: "info" });
        this.renderAnnotations();
    }

    addFreehandPoint(coords) {
        if (!this.drawingFreehand || !Array.isArray(coords)) return;
        const lastPoint = this.freehandPoints[this.freehandPoints.length - 1];
        if (lastPoint) {
            const dx = coords[0] - lastPoint[0];
            const dy = coords[1] - lastPoint[1];
            if (dx * dx + dy * dy < 0.5) {
                return;
            }
        }
        this.freehandPoints.push(coords);
        this.renderAnnotations();
    }

    finishFreehandDrawing() {
        if (!this.drawingFreehand) return;
        if (this.freehandPoints.length < 2) {
            this.cancelFreehandDrawing();
            this.updateStatusBadge("Линия слишком короткая. Попробуйте ещё раз.", { tone: "warning" });
            return;
        }

        const line = {
            type: "freehand",
            label: this.generateAnnotationLabel("Линия", "freehand"),
            points: this.freehandPoints.map(([x, y]) => [
                Number(x.toFixed(2)),
                Number(y.toFixed(2))
            ]),
            color: this.pickColor(this.annotations.length),
            labelVisible: false
        };

        this.annotations.push(line);
        this.drawingFreehand = false;
        this.freehandPoints = [];
        this.updateAnnotationCount();
        this.renderAnnotations();
        this.renderAnnotationList();
        this.updateStatusBadge("Линия добавлена. Нажмите ЛКМ, чтобы начать новую.", { tone: "success" });
        this.enforceRequiredCorrectBounds({ clampToMax: true });
        this.markUnsaved();
    }

    cancelFreehandDrawing() {
        this.drawingFreehand = false;
        this.freehandPoints = [];
        this.resetVertexEditingState();
    }

    selectAnnotation(index, options = {}) {
        if (index < 0 || index >= this.annotations.length) return;
        this.selectedAnnotationIndex = index;
        if (!options.preserveVertex) {
            this.resetVertexEditingState();
        }
        this.renderAnnotations();
        this.renderAnnotationList();
    }

    selectVertex(annotationIndex, vertexIndex) {
        if (annotationIndex < 0 || annotationIndex >= this.annotations.length) return;
        const annotation = this.annotations[annotationIndex];
        if (!annotation || !annotation.points || vertexIndex < 0 || vertexIndex >= annotation.points.length) return;
        this.selectedVertex = { annotationIndex, vertexIndex };
        this.renderAnnotations();
    }

    async clearAnnotations() {
        if (!this.annotations.length && !this.currentPolygonPoints.length) return;
        const confirmed = await this.confirmAction({
            title: "Удалить все контуры?",
            message: "Это удалит все текущие аннотации на изображении.",
            confirmText: "Удалить",
            cancelText: "Отмена",
            variant: "error"
        });
        if (!confirmed) return;
        this.annotations = [];
        this.currentPolygonPoints = [];
        this.selectedAnnotationIndex = -1;
        this.resetVertexEditingState();
        this.cancelPolygonDrawing();
        this.cancelFreehandDrawing();
        this.renderAnnotations();
        this.renderAnnotationList();
        this.updateAnnotationCount();
        this.enforceRequiredCorrectBounds({ clampToMax: true });
        this.updateDrawingControlsState();
        this.updateStatusBadge("Все контуры очищены.", { tone: "warning" });
        this.markUnsaved();
    }

    renderAnnotations() {
        if (!this.overlay) return;

        const width = this.baseImageWidth || this.img?.offsetWidth || 0;
        const height = this.baseImageHeight || this.img?.offsetHeight || 0;


        if (!width || !height) {
            this.overlay.innerHTML = "";
            return;
        }

        this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
        this.overlay.setAttribute("width", width);
        this.overlay.setAttribute("height", height);

        while (this.overlay.firstChild) {
            this.overlay.removeChild(this.overlay.firstChild);
        }

        const layers = {
            draft: this.createSvgElement("g", { class: "annotation-layer annotation-layer--draft" }),
            shapes: this.createSvgElement("g", { class: "annotation-layer annotation-layer--shapes" }),
            handles: this.createSvgElement("g", { class: "annotation-layer annotation-layer--handles" }),
            labels: this.createSvgElement("g", { class: "annotation-layer annotation-layer--labels" })
        };

        const selectedIndex = this.selectedAnnotationIndex;
        const activeVertex = this.selectedVertex;
        const labelBaseFontSize = this.getBaseLabelFontSize();
        const labelLayoutScale = this.getLabelScaleFactor();
        const labelVariant = this.labelDisplayMode === "compact" ? "compact" : "default";
        this.logScaleEvent("renderAnnotations", {
            annotations: this.annotations.length,
            width,
            height,
            labelBaseFontSize,
            labelLayoutScale,
            labelVariant,
            labelMode: this.labelDisplayMode
        });

        const appendLabel = (annotation, anchor, index, options = {}) => {
            if (!this.shouldRenderLabel(annotation, index)) {
                return;
            }
            const baseOptions = {
                annotationIndex: index,
                canvasWidth: width,
                canvasHeight: height,
                maxWidth: this.getLabelMaxWidth(width),
                baseFontSize: labelBaseFontSize,
                layoutScale: labelLayoutScale,
                variant: labelVariant
            };
            if (baseOptions.variant === "compact") {
                baseOptions.maxWidth = Math.min(baseOptions.maxWidth, 150);
                baseOptions.baseFontSize = Math.max(9, Math.round(labelBaseFontSize * 0.9));
                baseOptions.layoutScale = Math.max(0.7, labelLayoutScale * 0.85);
                baseOptions.maxLines = 2;
            }
            const labelGroup = this.drawLabel(annotation, anchor, {
                ...baseOptions,
                ...options
            });
            if (labelGroup) {
                layers.labels.appendChild(labelGroup);
            }
        };

        this.annotations.forEach((annotation, index) => {
            if (!annotation || (annotation.hidden && !this.showHiddenAnnotations)) {
                return;
            }

            const color = annotation.color || this.pickColor(index);
            if (!annotation.color) {
                this.annotations[index].color = color;
            }

            const isSelected = index === this.selectedAnnotationIndex;
            const isHighlighted = this.annotationHighlights.has(annotation);
            const isFreehand = annotation.type === "freehand";
            const points = annotation.points || [];
            const displayPoints = this.getDisplayPoints(points);

            const shapeClass = ["annotation-shape", `annotation-shape--${annotation.type || "unknown"}`];
            if (isSelected) {
                shapeClass.push("is-selected");
            }
            if (isHighlighted) {
                shapeClass.push("is-highlighted");
            }

            if (annotation.type === "polygon" && displayPoints.length >= 2) {
                const baseStrokeWidth = isSelected ? 2.6 : 1.8;
                const strokeColor = isHighlighted ? "#facc15" : color;
                const fillOpacity = isHighlighted ? 0.26 : isSelected ? 0.18 : 0.12;
                const strokeWidth = isHighlighted ? Math.max(baseStrokeWidth, 3) : baseStrokeWidth;

                const polygon = this.createSvgElement("path", {
                    d: this.buildPathData(displayPoints, true),
                    fill: color,
                    "fill-opacity": fillOpacity,
                    stroke: strokeColor,
                    "stroke-opacity": 0.92,
                    "stroke-width": strokeWidth,
                    "stroke-linejoin": "round",
                    "stroke-linecap": "round",
                    class: shapeClass.join(" "),
                    "data-annotation-index": index
                });
                layers.shapes.appendChild(polygon);
                if (isHighlighted && polygon.parentNode) {
                    polygon.parentNode.appendChild(polygon);
                }

                if (isSelected) {
                    displayPoints.forEach(([x, y], vertexIndex) => {
                        const isVertexSelected =
                            activeVertex &&
                            activeVertex.annotationIndex === index &&
                            activeVertex.vertexIndex === vertexIndex;
                        const handle = this.createSvgElement("circle", {
                            cx: x,
                            cy: y,
                            r: isVertexSelected ? 6 : 5,
                            fill: "#ffffff",
                            stroke: color,
                            "stroke-width": isVertexSelected ? 3 : 2,
                            class: `vertex-handle${isVertexSelected ? " is-active" : ""}`,
                            "data-annotation-index": index,
                            "data-vertex-index": vertexIndex
                        });
                        layers.handles.appendChild(handle);
                    });
                }

                const centroid = Array.isArray(points) && points.length ? this.getCentroid(points) : null;
                const centroidDisplay = Array.isArray(centroid) ? this.naturalToDisplay(centroid) : null;
                const fallbackAnchor =
                    displayPoints.length > 0
                        ? [
                            displayPoints.reduce((sum, [x]) => sum + x, 0) / displayPoints.length,
                            displayPoints.reduce((sum, [, y]) => sum + y, 0) / displayPoints.length
                        ]
                        : null;

                if (centroidDisplay || fallbackAnchor) {
                    appendLabel(annotation, centroidDisplay || fallbackAnchor, index);
                }
                return;
            }

            if (annotation.type === "freehand" && displayPoints.length >= 2) {
                const polyline = this.createSvgElement("polyline", {
                    points: displayPoints.map(([x, y]) => `${x},${y}`).join(" "),
                    fill: "none",
                    stroke: color,
                    "stroke-opacity": 0.95,
                    "stroke-width": isSelected ? 3 : 2,
                    "stroke-linejoin": "round",
                    "stroke-linecap": "round",
                    class: shapeClass.join(" "),
                    "data-annotation-index": index
                });
                layers.shapes.appendChild(polyline);
                if (isHighlighted && polyline.parentNode) {
                    polyline.parentNode.appendChild(polyline);
                }

                if (isSelected) {
                    const endpoints = [displayPoints[0], displayPoints[displayPoints.length - 1]];
                    endpoints.forEach(([x, y], vertexIndex) => {
                        const handle = this.createSvgElement("circle", {
                            cx: x,
                            cy: y,
                            r: 5,
                            fill: "#ffffff",
                            stroke: color,
                            "stroke-width": 2,
                            class: "vertex-handle vertex-handle--endpoint",
                            "data-annotation-index": index,
                            "data-vertex-index": vertexIndex === 0 ? 0 : displayPoints.length - 1
                        });
                        layers.handles.appendChild(handle);
                    });
                }

                const midpoint = this.getPolylineMidpoint(displayPoints);
                if (midpoint) {
                    appendLabel(annotation, midpoint, index, { maxWidth: 260 });
                }
                return;
            }

            if (annotation.type === "point") {
                const sourcePoint =
                    (Array.isArray(points) && points.length && points[0]) || annotation.point || null;
                const displayPoint = sourcePoint ? this.naturalToDisplay(sourcePoint) : null;
                if (!displayPoint) {
                    return;
                }

                const marker = this.createSvgElement("circle", {
                    cx: Number(displayPoint[0].toFixed(2)),
                    cy: Number(displayPoint[1].toFixed(2)),
                    r: isSelected ? 6 : 5,
                    fill: color,
                    stroke: "#ffffff",
                    "stroke-width": 2,
                    class: shapeClass.join(" "),
                    "data-annotation-index": index
                });
                layers.shapes.appendChild(marker);
                if (isHighlighted && marker.parentNode) {
                    marker.parentNode.appendChild(marker);
                }

                appendLabel(annotation, displayPoint, index, { maxWidth: 200 });
            }
        });

        if (this.currentPolygonPoints.length) {
            const draftPoints = this.getDisplayPoints(this.currentPolygonPoints);
            if (draftPoints.length) {
                const polygon = this.createSvgElement("path", {
                    d: this.buildPathData(draftPoints, true),
                    fill: "none",
                    stroke: "#f97316",
                    "stroke-width": 1.5,
                    "stroke-linejoin": "round",
                    "stroke-linecap": "round",
                    "stroke-dasharray": "6 4",
                    class: "annotation-draft annotation-draft--polygon"
                });
                layers.draft.appendChild(polygon);

                draftPoints.forEach(([x, y]) => {
                    const marker = this.createSvgElement("circle", {
                        cx: x,
                        cy: y,
                        r: 4.5,
                        fill: "#ffffff",
                        stroke: "#f97316",
                        "stroke-width": 1.5,
                        class: "draft-handle"
                    });
                    layers.draft.appendChild(marker);
                });
            }
        }

        if (this.drawingFreehand && this.freehandPoints.length) {
            const draftFreehand = this.getDisplayPoints(this.freehandPoints);
            if (draftFreehand.length >= 2) {
                const previewLine = this.createSvgElement("polyline", {
                    points: draftFreehand.map(([x, y]) => `${x},${y}`).join(" "),
                    fill: "none",
                    stroke: "#fb923c",
                    "stroke-width": 2,
                    "stroke-dasharray": "4 4",
                    class: "annotation-draft annotation-draft--freehand"
                });
                layers.draft.appendChild(previewLine);
            }
        }

        this.overlay.appendChild(layers.draft);
        this.overlay.appendChild(layers.shapes);
        this.overlay.appendChild(layers.handles);
        this.overlay.appendChild(layers.labels);
    }

    ensureLabelMeasureContext() {
        if (this.labelMeasureCtx) {
            return this.labelMeasureCtx;
        }
        if (!this.labelMeasureCanvas && typeof document !== "undefined") {
            this.labelMeasureCanvas = document.createElement("canvas");
            this.labelMeasureCanvas.width = 512;
            this.labelMeasureCanvas.height = 128;
        }
        if (this.labelMeasureCanvas) {
            this.labelMeasureCtx = this.labelMeasureCanvas.getContext("2d");
        }
        return this.labelMeasureCtx;
    }

    measureLabelTextWidth(text, fontSize = 14) {
        const ctx = this.ensureLabelMeasureContext();
        if (!ctx) {
            return (text || "").length * fontSize * 0.6;
        }
        ctx.font = `600 ${fontSize}px "Inter","Segoe UI",system-ui,sans-serif`;
        const metrics = ctx.measureText(text || "");
        return (metrics && metrics.width) || (text || "").length * fontSize * 0.6;
    }

    createSvgElement(tag, attrs = {}) {
        const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            element.setAttribute(key, String(value));
        });
        return element;
    }

    getDisplayPoints(points) {
        if (!Array.isArray(points)) return [];
        return points
            .map((point) => this.naturalToDisplay(point))
            .filter((coords) => Array.isArray(coords))
            .map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]);
    }

    buildPathData(points, closePath = false) {
        if (!Array.isArray(points) || !points.length) return "";
        const commands = points.map(([x, y], index) => {
            const prefix = index === 0 ? "M" : "L";
            return `${prefix}${x.toFixed(2)} ${y.toFixed(2)}`;
        });
        if (closePath && points.length > 2) {
            commands.push("Z");
        }
        return commands.join(" ");
    }

    getPolylineMidpoint(points) {
        if (!Array.isArray(points) || points.length === 0) return null;
        if (points.length === 1) return points[0];

        let totalLength = 0;
        const segments = [];
        for (let i = 1; i < points.length; i += 1) {
            const prev = points[i - 1];
            const current = points[i];
            const length = Math.hypot(current[0] - prev[0], current[1] - prev[1]);
            totalLength += length;
            segments.push({ prev, current, length });
        }

        if (totalLength === 0) {
            return points[0];
        }

        const halfLength = totalLength / 2;
        let traversed = 0;

        for (const segment of segments) {
            if (traversed + segment.length >= halfLength) {
                const delta = (halfLength - traversed) / (segment.length || 1);
                return [
                    segment.prev[0] + (segment.current[0] - segment.prev[0]) * delta,
                    segment.prev[1] + (segment.current[1] - segment.prev[1]) * delta
                ];
            }
            traversed += segment.length;
        }

        return points[points.length - 1];
    }

    drawLabel(annotation, anchor, options = {}) {
        const textSource = (annotation?.label ?? "").trim();
        const defaultTitle =
            options.fallbackText ||
            (annotation?.label?.trim()
                ? annotation.label.trim()
                : annotation?.type === "freehand"
                    ? "Линия"
                    : "Контур");
        const labelText = textSource || defaultTitle;
        if (!anchor || !labelText) {
            return null;
        }

        const canvasWidth = options.canvasWidth || this.baseImageWidth || this.img?.offsetWidth || 0;
        const canvasHeight = options.canvasHeight || this.baseImageHeight || this.img?.offsetHeight || 0;

        const variant = options.variant || "default";
        const layout = this.computeLabelLayout(labelText, {
            baseFontSize: options.baseFontSize || 12,
            maxWidth: Math.max(110, Math.min(options.maxWidth || 220, canvasWidth - 24)),
            maxLines: options.maxLines || (variant === "compact" ? 2 : 6),
            paddingScale: options.layoutScale ?? 1
        });

        const safePadding = 8;
        let labelX = anchor[0] - layout.width / 2;
        let labelY = anchor[1] - layout.height - 12;

        if (labelY < safePadding) {
            labelY = anchor[1] + 12;
        }

        labelX = Math.min(Math.max(labelX, safePadding), Math.max(safePadding, canvasWidth - layout.width - safePadding));
        labelY = Math.min(
            Math.max(labelY, safePadding),
            Math.max(safePadding, canvasHeight - layout.height - safePadding)
        );

        const groupClasses = ["annotation-label"];
        if (variant === "compact" || layout.lines.length >= 3) {
            groupClasses.push("annotation-label--compact");
        }

        const group = this.createSvgElement("g", {
            class: groupClasses.join(" "),
            "data-annotation-index": options.annotationIndex ?? ""
        });

        let connector = null;
        if ((options.showConnector ?? variant !== "compact")) {
            const connectorTargetY = anchor[1] < labelY ? labelY : labelY + layout.height;
            const connectorTargetX = Math.min(Math.max(anchor[0], labelX + 12), labelX + layout.width - 12);
            connector = this.createSvgElement("line", {
                x1: anchor[0],
                y1: anchor[1],
                x2: connectorTargetX,
                y2: connectorTargetY,
                stroke: "rgba(15,23,42,0.55)",
                "stroke-width": 1.3,
                class: "annotation-label__connector"
            });
        }

        const rect = this.createSvgElement("rect", {
            x: labelX,
            y: labelY,
            width: layout.width,
            height: layout.height,
            rx: 10,
            ry: 10,
            fill: "rgba(15,23,42,0.92)",
            stroke: "rgba(15,23,42,0.25)",
            "stroke-width": 1.2,
            class: "annotation-label__bg"
        });

        const text = this.createSvgElement("text", {
            x: labelX + layout.paddingX,
            y: labelY + layout.paddingY,
            fill: "#f1f5f9",
            "font-size": layout.fontSize,
            "font-weight": 600,
            "font-family": '"Inter","Segoe UI",system-ui,sans-serif',
            "dominant-baseline": "hanging",
            class: "annotation-label__text"
        });

        layout.lines.forEach((line, index) => {
            const tspan = this.createSvgElement("tspan", {
                x: labelX + layout.paddingX,
                dy: index === 0 ? 0 : layout.lineHeight
            });
            tspan.textContent = line || "\u00A0";
            text.appendChild(tspan);
        });

        if (connector) {
            group.appendChild(connector);
        }
        group.appendChild(rect);
        group.appendChild(text);
        return group;
    }

    breakWordIntoChunks(word, fontSize, maxLineWidth) {
        if (!word) return [];
        const chunks = [];
        let buffer = "";
        word.split("").forEach((char) => {
            const candidate = buffer + char;
            const width = this.measureLabelTextWidth(candidate, fontSize);
            if (width <= maxLineWidth || !buffer) {
                buffer = candidate;
            } else {
                chunks.push(buffer);
                buffer = char;
            }
        });
        if (buffer) {
            chunks.push(buffer);
        }
        return chunks;
    }

    buildLabelLayout(text, options = {}) {
        const { fontSize = 14, maxWidth = 220 } = options;
        const paddingX = 14;
        const paddingY = 10;
        const lineHeight = Math.round(fontSize * 1.3);
        const maxLineWidth = Math.max(60, maxWidth - paddingX * 2);
        const sanitized = (text ?? "").toString().trim() || "Без названия";
        const paragraphs = sanitized.replace(/\r/g, "").split(/\n+/);
        const lines = [];
        let widest = 0;
        let currentLine = "";

        const pushLine = (line) => {
            const content = line.trim();
            const width = content ? this.measureLabelTextWidth(content, fontSize) : 0;
            widest = Math.max(widest, width);
            lines.push(content);
        };

        const flushCurrentLine = () => {
            if (currentLine) {
                pushLine(currentLine);
                currentLine = "";
            }
        };

        paragraphs.forEach((paragraph, paragraphIndex) => {
            const words = paragraph.split(/\s+/).filter(Boolean);
            if (!words.length) {
                flushCurrentLine();
                lines.push("");
                return;
            }
            words.forEach((word) => {
                const candidate = currentLine ? `${currentLine} ${word}` : word;
                const candidateWidth = this.measureLabelTextWidth(candidate, fontSize);
                if (candidateWidth <= maxLineWidth) {
                    currentLine = candidate;
                    return;
                }

                if (currentLine) {
                    pushLine(currentLine);
                    currentLine = "";
                }

                const wordWidth = this.measureLabelTextWidth(word, fontSize);
                if (wordWidth <= maxLineWidth) {
                    currentLine = word;
                    return;
                }

                const chunks = this.breakWordIntoChunks(word, fontSize, maxLineWidth);
                chunks.forEach((chunk) => {
                    if (!chunk) return;
                    if (this.measureLabelTextWidth(chunk, fontSize) > maxLineWidth && chunk.length > 1) {
                        const nestedChunks = this.breakWordIntoChunks(chunk, fontSize, maxLineWidth);
                        nestedChunks.forEach((nestedChunk) => {
                            if (!nestedChunk) return;
                            pushLine(nestedChunk);
                        });
                        currentLine = "";
                    } else {
                        if (currentLine) {
                            pushLine(currentLine);
                        }
                        currentLine = chunk;
                        pushLine(currentLine);
                        currentLine = "";
                    }
                });
            });

            flushCurrentLine();
            if (paragraphIndex < paragraphs.length - 1) {
                lines.push("");
            }
        });

        if (!lines.length) {
            const fallback = sanitized || "Контур";
            lines.push(fallback);
            widest = this.measureLabelTextWidth(fallback, fontSize);
        }

        const width = Math.min(
            maxWidth,
            Math.max(paddingX * 2 + widest, paddingX * 2 + fontSize * 2, 90)
        );
        const height = Math.max(lineHeight + paddingY * 2, lines.length * lineHeight + paddingY * 2);

        return {
            fontSize,
            lineHeight,
            width: Math.round(width),
            height: Math.round(height),
            lines,
            paddingX,
            paddingY
        };
    }

    computeLabelLayout(text, options = {}) {
        if (this.helpers?.computeLabelLayout) {
            return this.helpers.computeLabelLayout(text, options);
        }
        const maxWidth = options.maxWidth || 240;
        const maxLines = options.maxLines || 6;
        const maxFontSize = options.maxFontSize || 16;
        const minFontSize = options.minFontSize || 11;
        let fontSize = options.baseFontSize || 14;
        fontSize = Math.max(minFontSize, Math.min(maxFontSize, fontSize));
        let layout = null;

        while (fontSize >= minFontSize) {
            layout = this.buildLabelLayout(text, { fontSize, maxWidth });
            if (layout.lines.length <= maxLines && layout.width <= maxWidth) {
                break;
            }
            fontSize -= 1;
        }

        if (!layout) {
            layout = this.buildLabelLayout(text, { fontSize: minFontSize, maxWidth });
        }

        return layout;
    }

    renderAnnotationList() {
        if (!this.annotationList) return;
        this.annotationList.innerHTML = "";

        this.annotations.forEach((ann, index) => {
            const isSelected = index === this.selectedAnnotationIndex;
            const isHighlighted = this.annotationHighlights.has(ann);
            const isFreehand = ann.type === "freehand";
            const li = document.createElement("li");
            li.dataset.annotationIndex = String(index);
            li.className = `flex flex-col gap-2 p-3 rounded-lg border transition ${isSelected ? "border-primary bg-primary-lighter shadow-sm" : "border-subtle hover:border-strong bg-surface-1"
                }`;
            li.classList.add("annotation-list-item");

            const header = document.createElement("div");
            header.className = "flex items-center gap-2";

            const colorDot = document.createElement("span");
            colorDot.className = "w-3.5 h-3.5 rounded-full border border-text-on-dark shadow-sm";
            colorDot.style.backgroundColor = ann.color || this.pickColor(index);

            const badge = document.createElement("div");
            badge.className = `w-7 h-7 text-xs font-bold rounded-full flex items-center justify-center ${isSelected
                ? "bg-surface-1 text-primary border border-primary shadow-sm"
                : "bg-primary-lighter text-primary-darker"
                }`;
            badge.textContent = index + 1;

            const meta = document.createElement("div");
            meta.className = "flex flex-col flex-1";
            const title = document.createElement("span");
            title.className = "text-xs uppercase tracking-wide text-text-muted";
            title.textContent = isFreehand ? "Линия" : "Контур";
            const stats = document.createElement("span");
            stats.className = "text-[11px] text-text-disabled";
            stats.textContent = `${ann.points.length} точек`;
            meta.appendChild(title);
            meta.appendChild(stats);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.title = "Удалить контур";
            deleteBtn.className = "delete-annotation-btn text-text-disabled hover:text-error transition-colors p-1.5 rounded-lg hover:bg-error-lighter";
            deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">delete</span>';
            deleteBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.deleteAnnotation(index);
            });

            header.appendChild(badge);
            header.appendChild(colorDot);
            header.appendChild(meta);
            header.appendChild(deleteBtn);

            const labelToggleBtn = document.createElement("button");
            labelToggleBtn.type = "button";
            labelToggleBtn.className = `flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border transition min-w-[90px] ${ann.labelVisible ? "border-primary text-primary bg-primary-lighter" : "border-subtle text-text-muted"
                }`;
            labelToggleBtn.innerHTML = `
                <span class="material-symbols-outlined text-[16px]">
                    ${ann.labelVisible ? "visibility" : "visibility_off"}
                </span>
                ${ann.labelVisible ? "Подпись" : "Показать"}
            `;
            labelToggleBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.annotations[index].labelVisible = !this.annotations[index].labelVisible;
                this.renderAnnotations();
                this.renderAnnotationList();
                this.markUnsaved();
            });

            const highlightBtn = document.createElement("button");
            highlightBtn.type = "button";
            highlightBtn.className =
                "flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border min-w-[90px] transition border-accent-light text-accent bg-accent-lighter hover:bg-accent-light";
            highlightBtn.innerHTML = `
                <span class="material-symbols-outlined text-[16px]">auto_awesome</span>
                ${isHighlighted ? "Мигает" : "Подсветить"}
            `;
            if (isHighlighted) {
                highlightBtn.disabled = true;
                highlightBtn.classList.add("opacity-60", "cursor-not-allowed");
            }
            highlightBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.highlightAnnotation(index);
            });

            const actionsRow = document.createElement("div");
            actionsRow.className = "flex items-center gap-2";
            actionsRow.appendChild(labelToggleBtn);
            actionsRow.appendChild(highlightBtn);

            const input = document.createElement("input");
            input.type = "text";
            input.value = ann.label || "";
            input.placeholder = isFreehand ? "Название линии" : "Название области";
            input.className =
                "annotation-label-input w-full border border-subtle rounded-lg px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary-light";
            input.addEventListener("pointerdown", (event) => {
                event.stopPropagation();
                if (this.selectedAnnotationIndex !== index) {
                    event.preventDefault();
                    this.selectAnnotation(index);
                    this.focusAnnotationLabelInput(index);
                }
            });
            input.addEventListener("click", (event) => {
                event.stopPropagation();
            });
            input.addEventListener("focus", (event) => {
                event.stopPropagation();
            });
            input.addEventListener("keydown", (event) => {
                event.stopPropagation();
            });
            input.addEventListener("input", (event) => {
                this.annotations[index].label = event.target.value;
                this.renderAnnotations();
                this.markUnsaved();
            });

            li.addEventListener("click", (event) => {
                if (event.target.closest("input,button")) return;
                this.selectAnnotation(index);
            });

            li.appendChild(header);
            li.appendChild(actionsRow);
            li.appendChild(input);
            this.annotationList.appendChild(li);
        });
    }

    focusAnnotationLabelInput(index) {
        requestAnimationFrame(() => {
            const selector = `#annotation-list [data-annotation-index="${index}"] .annotation-label-input`;
            const input = document.querySelector(selector);
            if (!input) return;
            input.focus({ preventScroll: true });
            const length = input.value.length;
            if (typeof input.setSelectionRange === "function") {
                input.setSelectionRange(length, length);
            }
        });
    }

    highlightAnnotation(index) {
        const annotation = this.annotations[index];
        if (!annotation) return;
        if (this.annotationHighlights.has(annotation)) {
            return;
        }

        this.annotationHighlights.set(annotation, true);
        this.renderAnnotations();
        this.renderAnnotationList();
        this.scrollAnnotationIntoView(index);

        if (this.highlightTimers.has(annotation)) {
            clearTimeout(this.highlightTimers.get(annotation));
        }

        const timer = setTimeout(() => {
            this.clearHighlightForAnnotation(annotation);
        }, 2500);

        this.highlightTimers.set(annotation, timer);
    }

    clearHighlightForAnnotation(annotation, options = {}) {
        if (!annotation) return;
        const { silent = false } = options;
        let updated = false;

        if (this.annotationHighlights.has(annotation)) {
            this.annotationHighlights.delete(annotation);
            updated = true;
        }
        if (this.highlightTimers.has(annotation)) {
            clearTimeout(this.highlightTimers.get(annotation));
            this.highlightTimers.delete(annotation);
            updated = true;
        }

        if (updated && !silent) {
            this.renderAnnotations();
            this.renderAnnotationList();
        }
    }

    resetHighlightState(options = {}) {
        const { silent = false } = options;
        if (this.highlightTimers) {
            this.highlightTimers.forEach((timer) => clearTimeout(timer));
        }
        this.annotationHighlights.clear();
        this.highlightTimers.clear();

        if (!silent) {
            this.renderAnnotations();
            this.renderAnnotationList();
        }
    }

    scrollAnnotationIntoView(index) {
        if (!this.annotationList) return;
        const item = this.annotationList.children[index];
        if (!item) return;
        item.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    updateAnnotationCount() {
        if (!this.annotationBadge) return;
        const count = this.annotations.length;
        this.annotationBadge.textContent = this.formatContourCount(count);
    }

    getContourWord(count) {
        return count === 1 ? "контур" : count >= 2 && count <= 4 ? "контура" : "контуров";
    }

    formatContourCount(count) {
        return `${count} ${this.getContourWord(count)}`;
    }

    updateRequiredCorrectUi(meta = {}) {
        if (!this.requiredCorrectInput) return;

        const annotationsCount = Number.isFinite(meta.annotationsCount) ? meta.annotationsCount : this.annotations.length;
        const hasContours = annotationsCount > 0;
        const currentValue = parseInt(this.requiredCorrectInput.value, 10);
        const value = Number.isFinite(meta.value) ? meta.value : (Number.isFinite(currentValue) ? currentValue : 0);
        const contourCountText = this.formatContourCount(annotationsCount);

        this.requiredCorrectInput.disabled = !hasContours;
        if (this.requiredCorrectContext) {
            this.requiredCorrectContext.textContent = `из ${contourCountText}`;
        }
        if (this.requiredCorrectHint) {
            if (!hasContours) {
                this.requiredCorrectHint.textContent = "Сначала добавьте хотя бы один контур.";
            } else if (meta.autoLowered) {
                this.requiredCorrectHint.textContent =
                    `Порог автоматически снижен до ${value} из ${contourCountText}, потому что контуров стало меньше.`;
            } else {
                this.requiredCorrectHint.textContent = `Нужно отметить ${value} из ${contourCountText}.`;
            }
        }
    }

    enforceRequiredCorrectBounds(options = {}) {
        const { clampToMax = false, markIfAdjusted = false } = options;
        if (!this.requiredCorrectInput) return null;
        const annotationsCount = this.annotations.length;
        const previousValue = parseInt(this.requiredCorrectInput.value, 10);

        if (this.helpers?.clampRequiredCorrectValue) {
            const result = this.helpers.clampRequiredCorrectValue(
                this.requiredCorrectInput.value,
                annotationsCount,
                { clampToMax }
            );
            this.requiredCorrectInput.min = String(result.min);
            this.requiredCorrectInput.max = String(result.max);
            this.requiredCorrectInput.value = String(result.value);
            const meta = {
                annotationsCount,
                value: result.value,
                min: result.min,
                max: result.max,
                adjusted: result.adjusted,
                autoLowered:
                    clampToMax && annotationsCount > 0 && Number.isFinite(previousValue) && previousValue > result.value
            };
            this.updateRequiredCorrectUi(meta);
            if (markIfAdjusted && result.adjusted) {
                this.markUnsaved();
            }
            return meta;
        }

        const minAllowed = annotationsCount === 0 ? 0 : 1;
        const maxAllowed = annotationsCount;
        this.requiredCorrectInput.min = String(minAllowed);
        this.requiredCorrectInput.max = String(Math.max(annotationsCount, minAllowed || 1));

        let value = parseInt(this.requiredCorrectInput.value, 10);
        if (!Number.isFinite(value)) {
            value = minAllowed;
        }

        let adjusted = false;
        if (value < minAllowed) {
            value = minAllowed;
            adjusted = true;
        }

        if (clampToMax) {
            if (annotationsCount === 0) {
                value = 0;
                adjusted = true;
            } else if (value > annotationsCount) {
                value = annotationsCount;
                adjusted = true;
            }
        }

        this.requiredCorrectInput.value = String(value);
        const meta = {
            annotationsCount,
            value,
            min: minAllowed,
            max: Math.max(annotationsCount, minAllowed || 1),
            adjusted,
            autoLowered: clampToMax && annotationsCount > 0 && Number.isFinite(previousValue) && previousValue > value
        };
        this.updateRequiredCorrectUi(meta);
        if (markIfAdjusted && adjusted) {
            this.markUnsaved();
        }
        return meta;
    }

    updateDrawingControlsState() {
        const polygonActive = this.currentTool === "polygon";
        const hasPoints = polygonActive && this.currentPolygonPoints.length > 0;
        if (this.finishBtn) {
            const canFinishPolygon = polygonActive && this.currentPolygonPoints.length >= 3;
            this.finishBtn.disabled = !canFinishPolygon;
            this.finishBtn.classList.toggle("bg-primary", canFinishPolygon);
            this.finishBtn.classList.toggle("text-primary-contrast", canFinishPolygon);
            this.finishBtn.classList.toggle("hover:bg-primary-dark", canFinishPolygon);
            this.finishBtn.classList.toggle("shadow-md", canFinishPolygon);
            this.finishBtn.classList.toggle("bg-primary-lighter", !canFinishPolygon);
            this.finishBtn.classList.toggle("text-primary", !canFinishPolygon);
            this.finishBtn.classList.toggle("hover:bg-primary", !canFinishPolygon);
        }
        if (this.deleteLastPointBtn) {
            const hasVertexSelection = Boolean(this.selectedVertex);
            this.deleteLastPointBtn.disabled = !hasPoints && !hasVertexSelection;
        }
        if (this.cancelPolygonBtn) {
            this.cancelPolygonBtn.disabled = !hasPoints;
        }
    }

    updateStatusBadge(message = "", options = {}) {
        if (!this.statusBadge) return;
        const statusTextEl = this.statusBadgeText || this.statusBadge;
        if (this.statusBadgeTimer) {
            clearTimeout(this.statusBadgeTimer);
            this.statusBadgeTimer = null;
        }

        this.statusBadge.classList.remove(
            "bg-surface-2",
            "bg-primary-lighter",
            "bg-success-lighter",
            "bg-warning-lighter",
            "bg-error-lighter",
            "text-text-secondary",
            "text-primary-darker",
            "text-success-text",
            "text-warning-text",
            "text-error-text",
            "border-transparent",
            "border-primary-light",
            "border-success-light",
            "border-warning-light",
            "border-error-light"
        );

        if (!message) {
            statusTextEl.textContent = "Режим ожидания";
            if (this.statusBadgeIcon) {
                this.statusBadgeIcon.textContent = "info";
            }
            this.statusBadge.classList.add("bg-surface-2", "text-text-secondary", "border-border-subtle");
            return;
        }

        const { tone = "neutral" } = options;
        const toneClasses = {
            neutral: ["bg-surface-2", "text-text-secondary", "border-border-subtle"],
            info: ["bg-primary-lighter", "text-primary-darker", "border-primary-light"],
            success: ["bg-success-lighter", "text-success-text", "border-success-light"],
            warning: ["bg-warning-lighter", "text-warning-text", "border-warning-light"],
            error: ["bg-error-lighter", "text-error-text", "border-error-light"]
        };

        const iconByTone = {
            neutral: "info",
            info: "tips_and_updates",
            success: "check_circle",
            warning: "warning",
            error: "error"
        };

        statusTextEl.textContent = message;
        if (this.statusBadgeIcon) {
            this.statusBadgeIcon.textContent = iconByTone[tone] || iconByTone.neutral;
        }
        this.statusBadge.classList.add(...(toneClasses[tone] || toneClasses.neutral));
    }

    clampZoom(value) {
        return Math.min(this.maxZoom, Math.max(this.minZoom, value));
    }

    resetViewport() {
        this.zoomLevel = 1;
        if (typeof this.initialPanX === "number" && typeof this.initialPanY === "number") {
            this.panX = this.initialPanX;
            this.panY = this.initialPanY;
        } else {
            this.panX = 0;
            this.panY = 0;
        }
        this.updateStageTransform();
        this.updateZoomDisplay();
        this.logScaleEvent("resetViewport");
    }

    updateStageTransform() {
        const scaleValue = `scale(${this.zoomLevel})`;
        if (this.canvasStage) {
            this.canvasStage.style.transformOrigin = "0 0";
            this.canvasStage.style.transform = `translate(${this.panX}px, ${this.panY}px) ${scaleValue}`;
        }
        const resetTransform = (el) => {
            if (!el) return;
            el.style.transformOrigin = "";
            el.style.transform = "";
        };
        resetTransform(this.img);
        resetTransform(this.imagePlaceholder);
        resetTransform(this.overlayWrapper);
        this.logScaleEvent("updateStageTransform", { scaleValue, appliedTo: "stage" });
    }

    updateZoomDisplay() {
        if (this.zoomDisplay) {
            this.zoomDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    adjustZoom(direction) {
        const delta = direction > 0 ? this.zoomStep : -this.zoomStep;
        const containerRect = this.canvasContainer?.getBoundingClientRect();
        let focal = null;
        if (containerRect) {
            focal = {
                x: containerRect.width / 2,
                y: containerRect.height / 2
            };
        }
        this.logScaleEvent("adjustZoom", {
            direction,
            delta,
            targetZoom: this.zoomLevel + delta,
            focal
        });
        this.applyZoom(this.zoomLevel + delta, focal);
    }

    handleCanvasWheel(event) {
        if (!this.canvasContainer) return;
        event.preventDefault();
        const delta = event.deltaY > 0 ? -this.zoomStep : this.zoomStep;
        const containerRect = this.canvasContainer.getBoundingClientRect();
        const focal = {
            x: event.clientX - containerRect.left,
            y: event.clientY - containerRect.top
        };
        this.logScaleEvent("wheelZoom", {
            deltaY: event.deltaY,
            delta,
            targetZoom: this.zoomLevel + delta,
            focal
        });
        this.applyZoom(this.zoomLevel + delta, focal);
    }

    applyZoom(targetZoom, focalPoint = null) {
        if (!this.canvasContainer) return;
        const newZoom = this.clampZoom(targetZoom);
        if (Math.abs(newZoom - this.zoomLevel) < 0.001) return;

        const containerRect = this.canvasContainer.getBoundingClientRect();
        const focal = focalPoint || {
            x: containerRect.width / 2,
            y: containerRect.height / 2
        };

        const worldX = (focal.x - this.panX) / this.zoomLevel;
        const worldY = (focal.y - this.panY) / this.zoomLevel;

        this.logScaleEvent("applyZoom:before", {
            targetZoom,
            clampedZoom: newZoom,
            focal,
            worldX,
            worldY
        });

        this.zoomLevel = newZoom;
        this.panX = focal.x - worldX * this.zoomLevel;
        this.panY = focal.y - worldY * this.zoomLevel;

        this.updateStageTransform();
        this.updateZoomDisplay();
        this.recalculateImageMetrics();
        this.renderAnnotations();

        this.logScaleEvent("applyZoom:after", {
            focal,
            worldX,
            worldY
        });
    }

    resetImageMetrics() {
        this.baseImageWidth = 0;
        this.baseImageHeight = 0;
        this.displayImageWidth = 0;
        this.displayImageHeight = 0;
        this.hasCenteredImage = false;
    }

    applyEmptyCanvasStageSize() {
        if (!this.canvasContainer || !this.canvasStage) return;

        const containerRect = this.canvasContainer.getBoundingClientRect();
        const width = Math.min(720, Math.max(240, Math.floor(containerRect.width - 32)));
        const height = Math.min(420, Math.max(220, Math.floor(containerRect.height - 32)));

        this.baseImageWidth = width;
        this.baseImageHeight = height;
        this.displayImageWidth = width;
        this.displayImageHeight = height;

        this.canvasStage.style.width = `${width}px`;
        this.canvasStage.style.height = `${height}px`;

        if (this.overlay) {
            this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
            this.overlay.setAttribute("width", width);
            this.overlay.setAttribute("height", height);
        }

        if (this.overlayWrapper) {
            this.overlayWrapper.style.width = `${width}px`;
            this.overlayWrapper.style.height = `${height}px`;
        }

        this.centerImageInContainer();
        this.hasCenteredImage = true;
    }

    recalculateImageMetrics(forceBase = false) {
        this.captureBaseImageMetrics({ forceBase });
    }

    captureBaseImageMetrics(options = {}) {
        const { forceBase = false } = options;
        if (!this.img || this.img.classList.contains("hidden")) return;
        const width = this.img.offsetWidth || this.img.clientWidth || this.img.naturalWidth;
        const height = this.img.offsetHeight || this.img.clientHeight || this.img.naturalHeight;
        if (!width || !height) return;

        this.displayImageWidth = width;
        this.displayImageHeight = height;

        const shouldUpdateBase =
            forceBase || !this.baseImageWidth || !this.baseImageHeight;

        if (shouldUpdateBase) {
            this.baseImageWidth = width;
            this.baseImageHeight = height;

            if (this.canvasStage) {
                this.canvasStage.style.width = `${width}px`;
                this.canvasStage.style.height = `${height}px`;
            }

            if (this.overlay) {
                this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
                this.overlay.setAttribute("width", width);
                this.overlay.setAttribute("height", height);
            }

            if (this.overlayWrapper) {
                this.overlayWrapper.style.width = `${width}px`;
                this.overlayWrapper.style.height = `${height}px`;
            }
        }

        if (!this.hasCenteredImage && shouldUpdateBase) {
            this.centerImageInContainer();
            this.hasCenteredImage = true;
        }
    }

    centerImageInContainer() {
        if (!this.canvasContainer) return;
        const containerRect = this.canvasContainer.getBoundingClientRect();
        const width = this.baseImageWidth || this.img?.offsetWidth || 0;
        const height = this.baseImageHeight || this.img?.offsetHeight || 0;
        if (!width || !height) return;

        this.initialPanX = (containerRect.width - width) / 2;
        this.initialPanY = (containerRect.height - height) / 2;
        this.panX = this.initialPanX;
        this.panY = this.initialPanY;
        this.updateStageTransform();
    }

    clientToNatural(clientX, clientY) {
        if (!this.canvasContainer || !this.img) return null;
        const containerRect = this.canvasContainer.getBoundingClientRect();
        const screenX = clientX - containerRect.left;
        const screenY = clientY - containerRect.top;

        const baseWidth = this.baseImageWidth || this.img.offsetWidth || 1;
        const baseHeight = this.baseImageHeight || this.img.offsetHeight || 1;

        const localX = (screenX - this.panX) / this.zoomLevel;
        const localY = (screenY - this.panY) / this.zoomLevel;

        if (localX < 0 || localY < 0 || localX > baseWidth || localY > baseHeight) {
            return null;
        }

        const naturalWidth = this.img.naturalWidth || baseWidth;
        const naturalHeight = this.img.naturalHeight || baseHeight;

        const naturalX = (localX / baseWidth) * naturalWidth;
        const naturalY = (localY / baseHeight) * naturalHeight;
        return [naturalX, naturalY];
    }

    naturalToDisplay([x, y]) {
        const baseWidth = this.baseImageWidth || this.img?.offsetWidth || 1;
        const baseHeight = this.baseImageHeight || this.img?.offsetHeight || 1;
        const naturalWidth = this.img?.naturalWidth || baseWidth;
        const naturalHeight = this.img?.naturalHeight || baseHeight;
        const displayX = (x / naturalWidth) * baseWidth;
        const displayY = (y / naturalHeight) * baseHeight;
        return [displayX, displayY];
    }

    getCentroid(points) {
        if (!points.length) return null;
        const sum = points.reduce(
            (acc, [x, y]) => {
                acc.x += x;
                acc.y += y;
                return acc;
            },
            { x: 0, y: 0 }
        );
        return [sum.x / points.length, sum.y / points.length];
    }

    getDisplayBounds(points) {
        if (!Array.isArray(points) || !points.length) return null;
        const displayPoints = points
            .map((point) => this.naturalToDisplay(point))
            .filter((coord) => Array.isArray(coord));
        if (!displayPoints.length) return null;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        displayPoints.forEach(([dx, dy]) => {
            if (dx < minX) minX = dx;
            if (dx > maxX) maxX = dx;
            if (dy < minY) minY = dy;
            if (dy > maxY) maxY = dy;
        });
        return {
            width: Math.max(0, maxX - minX),
            height: Math.max(0, maxY - minY),
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    truncateLabelText(text, maxLength = 22) {
        const source = (text ?? "").toString().trim();
        if (!source) return "";
        if (source.length <= maxLength) {
            return source;
        }
        return `${source.slice(0, Math.max(3, maxLength - 1)).trimEnd()}…`;
    }

    async handleMainImageUpload(event) {
        const file = event.target.files?.[0];
        if (!file || !this.task) return;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("module", this.task.task_data?.meta?.module);
        formData.append("topic", this.task.task_data?.meta?.topic);
        formData.append("task", this.task.metadata?.id);
        try {
            const response = await fetch("/api/editor/upload-image", {
                method: "POST",
                body: formData
            });
            const data = await response.json();
            if (!data.ok) {
                this.showToast(`Ошибка загрузки: ${data.error || "upload_failed"}`, "error");
                return;
            }
            if (!this.task.task_data) {
                this.task.task_data = {};
            }
            if (!this.task.task_data.content || typeof this.task.task_data.content !== "object") {
                this.task.task_data.content = {};
            }
            
            // Capture live UI state (e.g. prompt, additional info) before re-rendering
            const snapshot = this.buildLiveContentSnapshot();
            
            // Merge: preserve everything in current content, then overwrite with live snapshot, then set new image
            this.task.task_data.content = {
                ...(this.task.task_data.content || {}),
                ...snapshot,
                image: this.serializeImageReference({
                    path: data.path,
                    asset_id: data.asset_id,
                    asset_url: data.asset_url,
                }) || data.path
            };
            
            this.renderUI();
            this.markUnsaved();
        } catch (error) {
            console.error("Ошибка загрузки изображения:", error);
            this.showToast("Ошибка при загрузке изображения. Подробности в консоли.", "error");
        } finally {
            event.target.value = "";
        }
    }

    handleImageError() {
        if (!this.imagePlaceholder || !this.img) return;
        this.resetImageMetrics();
        this.imagePlaceholder.classList.remove("hidden");
        this.img.classList.add("hidden");
        this.applyEmptyCanvasStageSize();
        this.resetViewport();
        this.renderAnnotations();
        this.updateStatusBadge("Не удалось загрузить изображение");
    }

    countOverlappingErrorPairs(spans = []) {
        if (!Array.isArray(spans) || spans.length < 2) return 0;
        const normalized = spans
            .map((span) => {
                const start = Number.isFinite(span?.start) ? span.start : 0;
                const end = Number.isFinite(span?.end) ? span.end : start;
                return { start: Math.min(start, end), end: Math.max(start, end) };
            })
            .sort((a, b) => a.start - b.start || a.end - b.end);

        let overlaps = 0;
        for (let i = 1; i < normalized.length; i += 1) {
            if (normalized[i].start < normalized[i - 1].end) {
                overlaps += 1;
            }
        }
        return overlaps;
    }

    collectDuplicateLabels(values = []) {
        const duplicates = [];
        const seen = new Set();
        values.forEach((value) => {
            const text = String(value || "").trim();
            if (!text) return;
            const key = text.toLowerCase();
            if (seen.has(key)) {
                if (!duplicates.includes(text)) {
                    duplicates.push(text);
                }
                return;
            }
            seen.add(key);
        });
        return duplicates;
    }

    isGeneratedAnnotationLabel(label) {
        const normalized = String(label || "").trim().toLowerCase();
        return /^(контур|линия)\s+\d+$/i.test(normalized);
    }

    getSemanticWarnings() {
        const warnings = [];

        if (this.isErrorDetectionTask()) {
            const mode = this.errorDetection.mode || (this.task?.task_data?.content?.mode ?? "text_errors");
            if (mode === "text_choice") {
                const options = this.getChoiceOptionsArray().map((opt) => opt?.text || "");
                const duplicates = this.collectDuplicateLabels(options);
                if (duplicates.length) {
                    warnings.push(`Повторяются варианты ответа: ${duplicates.slice(0, 2).join(", ")}.`);
                }
            } else {
                const overlaps = this.countOverlappingErrorPairs(this.getErrorSpansArray());
                if (overlaps > 0) {
                    warnings.push(`Есть ${overlaps} пересечений между диапазонами ошибок. Пользователь может получить неоднозначную разметку.`);
                }
            }
            return warnings;
        }

        const labels = this.annotations.map((annotation) => annotation?.label || "");
        const duplicates = this.collectDuplicateLabels(labels);
        if (duplicates.length) {
            warnings.push(`Повторяются названия контуров: ${duplicates.slice(0, 2).join(", ")}.`);
        }

        const generatedLabels = this.annotations.filter((annotation) => this.isGeneratedAnnotationLabel(annotation?.label)).length;
        if (generatedLabels > 0) {
            warnings.push(`У ${generatedLabels} контуров осталось автосгенерированное имя. Лучше заменить его на содержательную подпись.`);
        }

        const requiredCorrect = this.requiredCorrectInput
            ? parseInt(this.requiredCorrectInput.value, 10)
            : Number(
                this.task?.task_data?.settings?.success_threshold ??
                this.task?.task_data?.content?.required_correct ??
                0
            );
        if (this.annotations.length > 1 && Number.isFinite(requiredCorrect) && requiredCorrect === this.annotations.length) {
            warnings.push('Сейчас пользователь должен отметить все контуры. Убедитесь, что такой порог действительно нужен.');
        }

        return warnings;
    }

    async saveTask() {
        if (!this.task) return;

        const prompt = this.promptArea ? this.promptArea.value.trim() : "";
        const choicePrompt = this.choicePromptTextarea ? this.choicePromptTextarea.value.trim() : "";
        const isErrorDetection = this.isErrorDetectionTask();
        const requiredCorrect = this.requiredCorrectInput ? parseInt(this.requiredCorrectInput.value, 10) : 1;

        const effectivePrompt = prompt || DEFAULT_PROMPT;
        const effectiveChoicePrompt = choicePrompt || prompt || DEFAULT_CHOICE_PROMPT;
        
        if (isErrorDetection && !this.validateErrorDetectionBeforeSave()) {
            return;
        }

        if (!isErrorDetection) {
            const validationError = this.validateTask();
            if (validationError) {
                this.showToast(validationError, "warning");
                return;
            }
        }
        if (!isErrorDetection && !this.task.task_data?.content?.image) {
            this.showToast("Загрузите основное изображение задания.", "error");
            return;
        }

        if (!isErrorDetection) {
            if (!this.annotations.length) {
                this.showToast("Добавьте минимум один контур.", "error");
                return;
            }
            if (!Number.isFinite(requiredCorrect) || requiredCorrect < 1) {
                this.showToast("Количество необходимых правильных аннотаций должно быть положительным числом.", "error");
                this.requiredCorrectInput?.focus();
                return;
            }
            if (requiredCorrect > this.annotations.length) {
                this.showToast("Количество нужных аннотаций не может превышать общее число контуров.", "error");
                this.requiredCorrectInput?.focus();
                return;
            }
        }

        if (!this.task.task_data) {
            this.task.task_data = {};
        }
        if (!this.task.task_data.meta || typeof this.task.task_data.meta !== "object") {
            this.task.task_data.meta = {};
        }
        if (!this.task.task_data.content) {
            this.task.task_data.content = {};
        }
        if (!this.task.task_data.settings || typeof this.task.task_data.settings !== "object") {
            this.task.task_data.settings = {};
        }
        this.task.task_data.id = this.taskId || this.task.task_data.id;
        if (!this.task.task_data.type) {
            this.task.task_data.type = this.taskTypeParam || this.task.task_data?.type || "click";
        }
        this.task.task_data.meta.id = this.taskId || this.task.task_data.meta.id;
        this.task.task_data.meta.module = this.moduleId || this.task.task_data.meta.module;
        this.task.task_data.meta.topic = this.topicId || this.task.task_data.meta.topic;
        this.task.task_data.meta.name = this.taskNameParam || this.task.metadata?.name || this.task.metadata?.id || this.taskId;
        this.task.task_data.name = this.task.task_data.meta.name;
        this.task.task_data.settings = this.buildLiveSettingsSnapshot();
        const difficultySettingsOk = await this.applyDifficultyAuthoringSettings(this.task.task_data, { showValidationToast: true });
        if (!difficultySettingsOk) {
            const blockingState = this.getBlockingEditorState(this.task.task_data);
            if (blockingState) {
                this.updateSaveStatus(this.getBlockingSaveStatusOptions(blockingState));
            } else {
                this.updateSaveStatus();
            }
            return;
        }
        this.task.task_data.content.prompt = effectivePrompt;
        const additionalPayload = this.serializeAdditionalInfo();
        if (isErrorDetection) {
            this.enableErrorDetectionEditor();
            this.applyErrorsRequiredCorrectToContent(this.task.task_data.content);
            this.applyReferenceDataToContent(this.task.task_data.content);
            this.task.task_data.subtype = "error_detection";
            this.task.task_data.content.subtype = "error_detection";
            delete this.task.task_data.settings.success_threshold;
            delete this.task.task_data.content.annotations;
            delete this.task.task_data.content.image;
            const edMode = this.errorDetection.mode || this.task.task_data.content.mode || "text_errors";
            if (edMode === "text_choice") {
                this.task.task_data.content.choice_prompt = effectiveChoicePrompt;
            } else {
                delete this.task.task_data.content.choice_prompt;
                if (this.errorsRequireAllCheckbox) {
                    this.task.task_data.content.require_all_errors = this.errorsRequireAllCheckbox.checked;
                }
            }
        } else {
            this.task.task_data.content.choice_prompt = effectiveChoicePrompt;
            this.task.task_data.content.required_correct = requiredCorrect;
            this.task.task_data.settings.success_threshold = requiredCorrect;
            this.task.task_data.content.annotations = this.annotations;
        }
        if (additionalPayload) {
            this.task.task_data.content.additionalInfo = additionalPayload;
        } else {
            delete this.task.task_data.content.additionalInfo;
        }

        const moduleId = this.moduleId || this.task.task_data?.meta?.module || this.task.metadata?.module;
        const topicId = this.topicId || this.task.task_data?.meta?.topic || this.task.metadata?.topic;
        const taskId = this.taskId || this.task.metadata?.id || this.task.task_data?.meta?.id;
        if (!moduleId || !topicId || !taskId) {
            this.showToast("Не удалось определить идентификаторы задания (module/topic/task). Перезагрузите редактор из списка задач.", "error");
            return;
        }

        try {
            const nowIso = new Date().toISOString();
            if (this.task.task_data?.meta) {
                this.task.task_data.meta.modified = nowIso;
                if (!this.task.task_data.meta.created_at) {
                    this.task.task_data.meta.created_at = nowIso;
                }
            }
            const payload = this._cloneSerializable(this.task.task_data);
            this.sanitizeDifficultyAuthoringPayload(payload, this.difficultyAuthoring.activeMeta);
            const response = await fetch(`/api/editor/task/${moduleId}/${topicId}/${taskId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (response.status === 409 && data?.error === 'workspace_limit_reached') {
                this.updateSaveStatus({
                    type: "warning",
                    message: "Лимит заданий достигнут",
                    detail: "Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.",
                });
                this.showToast("Лимит заданий достигнут. Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.", "warning");
            } else if (data.ok) {
                const semanticWarnings = this.getSemanticWarnings();
                if (!semanticWarnings.length) {
                    this.showToast("Задание сохранено.", "success");
                }
                this.hasPersistedTask = true;
                this.isNewTaskParam = false;
                this.initialTaskSnapshot = this.captureTaskSnapshot();
                this.hasUnsavedChanges = false;
                this.additionalInfoDirty = false;
                this.updateSaveStatus(false);
                if (this.autoSaveManager) {
                    this.autoSaveManager.clearDraft();
                }
                this.clearTaskBootstrap();
                this.cleanupPersistedTaskRoute();
                if (semanticWarnings.length) {
                    this.updateSaveStatus({
                        type: "warning",
                        message: "Сохранено с предупреждениями",
                        detail: this.buildSemanticWarningsDetail(semanticWarnings)
                    });
                    this.showToast(this.buildSemanticWarningsToast(semanticWarnings), "warning", 5200);
                }
            } else {
                this.showToast(`Ошибка сохранения: ${data.error || "save_failed"}`, "error");
            }
        } catch (error) {
            console.error("Error saving task:", error);
            this.showToast("Ошибка при сохранении. Проверьте консоль.", "error");
        }
    }

    markUnsaved() {
        this.hasUnsavedChanges = true;
        BaseEditor.prototype.updateSaveStatus.call(this);
    }

    captureTaskSnapshot() {
        if (!this.task) return null;
        const prompt = this.promptArea ? this.promptArea.value.trim() : "";
        const choicePrompt = this.choicePromptTextarea ? this.choicePromptTextarea.value.trim() : "";
        const required = this.requiredCorrectInput ? String(this.requiredCorrectInput.value).trim() : "";
        const image = JSON.stringify(this.serializeImageReference(this.task.task_data?.content?.image) || null);
        const annotationsHash = JSON.stringify(this.annotations);
        const additionalHash = JSON.stringify(this.serializeAdditionalInfo());
        return `${prompt}|${choicePrompt}|${required}|${image}|${annotationsHash}|${additionalHash}`;
    }

    handlePotentialChange(previousSnapshot, options = {}) {
        if (!previousSnapshot || options?.skipIfSame) {
            const currentSnapshot = this.captureTaskSnapshot();
            if (!currentSnapshot || !previousSnapshot) return;
            if (currentSnapshot !== previousSnapshot) {
                this.markUnsaved();
            }
            return;
        }
        const currentSnapshot = this.captureTaskSnapshot();
        if (currentSnapshot && currentSnapshot !== previousSnapshot) {
            this.markUnsaved();
        }
    }

    updateSaveStatus(state) {
        const options = (typeof state === "object" && state !== null) ? state : {};
        BaseEditor.prototype.updateSaveStatus.call(this, options);
    }

    async confirmAction({
        title = "Подтверждение",
        message = "Вы уверены?",
        confirmText = "Подтвердить",
        cancelText = "Отмена",
        variant = "error"
    } = {}) {
        if (typeof this.showConfirmModal === "function") {
            return new Promise((resolve) => {
                this.showConfirmModal({
                    title,
                    message,
                    confirmText,
                    cancelText,
                    variant,
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
        }
        if (typeof NotificationUI !== "undefined" && typeof NotificationUI.confirm === "function") {
            return NotificationUI.confirm({ title, message, confirmText, cancelText, variant });
        }
        return window.confirm(message);
    }

    initToolbarTooltips() {
        const containers = [this.toolbarRow, this.toolbarStatusRow].filter(Boolean);
        if (!containers.length) {
            return;
        }

        const targets = new Set();
        containers.forEach((container) => {
            container.querySelectorAll("[data-toolbar-tooltip]").forEach((el) => {
                targets.add(el);
            });
        });

        targets.forEach((target) => {
            if (!(target instanceof HTMLElement) || target.dataset.toolbarTooltipBound === "1") {
                return;
            }

            const tooltipText =
                target.dataset.toolbarTooltip ||
                target.getAttribute("title") ||
                target.getAttribute("aria-label") ||
                "";
            if (!tooltipText.trim()) {
                return;
            }

            target.dataset.toolbarTooltip = tooltipText.trim();
            target.setAttribute("title", tooltipText.trim());
            target.querySelectorAll?.("button, [tabindex], a, input, select, textarea").forEach((child) => {
                if (child instanceof HTMLElement && !child.getAttribute("title")) {
                    child.setAttribute("title", tooltipText.trim());
                }
            });
            target.dataset.toolbarTooltipBound = "1";
            this.bindToolbarTooltipTarget(target);
        });

        containers.forEach((container) => {
            if (!(container instanceof HTMLElement) || container.dataset.toolbarTooltipEventsBound === "1") {
                return;
            }

            container.addEventListener("pointerover", (event) => {
                const target = this.resolveToolbarTooltipTarget(event.target);
                if (!target) {
                    return;
                }
                const relatedTarget = this.resolveToolbarTooltipTarget(event.relatedTarget);
                if (relatedTarget === target) {
                    return;
                }
                this.scheduleToolbarTooltip(target);
            });

            container.addEventListener("pointerout", (event) => {
                const target = this.resolveToolbarTooltipTarget(event.target);
                if (!target) {
                    return;
                }
                const relatedTarget = this.resolveToolbarTooltipTarget(event.relatedTarget);
                if (relatedTarget === target) {
                    return;
                }
                this.hideToolbarTooltip({ immediate: true });
            });

            container.addEventListener("focusin", (event) => {
                const target = this.resolveToolbarTooltipTarget(event.target);
                if (target) {
                    this.showToolbarTooltip(target, { immediate: true });
                }
            });

            container.addEventListener("focusout", (event) => {
                const target = this.resolveToolbarTooltipTarget(event.target);
                if (!target) {
                    return;
                }
                const relatedTarget = this.resolveToolbarTooltipTarget(event.relatedTarget);
                if (relatedTarget === target) {
                    return;
                }
                this.hideToolbarTooltip({ immediate: true });
            });

            container.addEventListener("pointerdown", () => {
                this.hideToolbarTooltip({ immediate: true });
            });

            container.dataset.toolbarTooltipEventsBound = "1";
        });

        if (!this.toolbarTooltipDismissBound) {
            this.toolbarTooltipDismissBound = true;
            window.addEventListener("scroll", () => this.hideToolbarTooltip({ immediate: true }), true);
            window.addEventListener("resize", () => this.hideToolbarTooltip({ immediate: true }));
        }
    }

    resolveToolbarTooltipTarget(node) {
        if (!(node instanceof HTMLElement)) {
            return null;
        }
        return node.closest?.("[data-toolbar-tooltip]") || null;
    }

    bindToolbarTooltipTarget(target) {
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const bindableNodes = [target, ...target.querySelectorAll("button, [tabindex], a, input, select, textarea")];
        bindableNodes.forEach((node) => {
            if (!(node instanceof HTMLElement) || node.dataset.toolbarTooltipNodeBound === "1") {
                return;
            }

            node.addEventListener("mouseenter", () => {
                this.scheduleToolbarTooltip(target);
            });
            node.addEventListener("mouseleave", () => {
                this.hideToolbarTooltip({ immediate: true });
            });
            node.addEventListener("focus", () => {
                this.showToolbarTooltip(target, { immediate: true });
            });
            node.addEventListener("blur", () => {
                this.hideToolbarTooltip({ immediate: true });
            });
            node.addEventListener("pointerdown", () => {
                this.hideToolbarTooltip({ immediate: true });
            });

            node.dataset.toolbarTooltipNodeBound = "1";
        });
    }

    scheduleToolbarTooltip(target) {
        if (!(target instanceof HTMLElement)) {
            return;
        }
        if (this.toolbarTooltipTimer) {
            clearTimeout(this.toolbarTooltipTimer);
            this.toolbarTooltipTimer = null;
        }
        this.toolbarTooltipTimer = setTimeout(() => {
            this.showToolbarTooltip(target);
        }, 450);
    }

    ensureToolbarTooltip() {
        if (this.toolbarTooltipEl) {
            return this.toolbarTooltipEl;
        }
        const tooltip = document.createElement("div");
        tooltip.id = "editor-toolbar-tooltip";
        tooltip.className = "fixed z-[2100] pointer-events-none max-w-[18rem] rounded-xl px-3 py-2 text-xs font-medium leading-snug shadow-2xl border border-white/10 opacity-0 transition-opacity duration-150";
        tooltip.style.background = "rgba(15, 23, 42, 0.94)";
        tooltip.style.color = "#ffffff";
        tooltip.style.backdropFilter = "blur(8px)";
        document.body.appendChild(tooltip);
        this.toolbarTooltipEl = tooltip;
        return tooltip;
    }

    showToolbarTooltip(target, options = {}) {
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const tooltipText = (target.dataset.toolbarTooltip || "").trim();
        if (!tooltipText) {
            return;
        }
        if (this.toolbarTooltipTimer) {
            clearTimeout(this.toolbarTooltipTimer);
            this.toolbarTooltipTimer = null;
        }

        const tooltip = this.ensureToolbarTooltip();
        tooltip.textContent = tooltipText;
        tooltip.classList.remove("opacity-0");
        this.toolbarTooltipTarget = target;
        this.positionToolbarTooltip(target);
    }

    positionToolbarTooltip(target) {
        if (!this.toolbarTooltipEl || !(target instanceof HTMLElement)) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const tooltipRect = this.toolbarTooltipEl.getBoundingClientRect();
        const margin = 12;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

        let top = rect.top - tooltipRect.height - 10;
        if (top < margin) {
            top = rect.bottom + 10;
        }

        this.toolbarTooltipEl.style.left = `${Math.round(left)}px`;
        this.toolbarTooltipEl.style.top = `${Math.round(top)}px`;
    }

    hideToolbarTooltip({ immediate = false } = {}) {
        if (this.toolbarTooltipTimer) {
            clearTimeout(this.toolbarTooltipTimer);
            this.toolbarTooltipTimer = null;
        }
        this.toolbarTooltipTarget = null;
        if (!this.toolbarTooltipEl) {
            return;
        }
        if (immediate) {
            this.toolbarTooltipEl.classList.add("opacity-0");
            return;
        }
        const scheduleHide = typeof requestAnimationFrame === "function"
            ? requestAnimationFrame.bind(window)
            : (callback) => setTimeout(callback, 0);
        scheduleHide(() => {
            this.toolbarTooltipEl?.classList.add("opacity-0");
        });
    }

    showToast(message, variant = "success", duration = 2500, options = {}) {
        if (typeof document === "undefined") return;
        const existing = document.querySelector("#click-editor-toast");
        if (existing) existing.remove();
        if (this.toastHideTimer) {
            clearTimeout(this.toastHideTimer);
            this.toastHideTimer = null;
        }
        if (typeof this.toastDismissCallback === "function") {
            this.toastDismissCallback("replaced");
            this.toastDismissCallback = null;
        }

        const palette = {
            success: { bg: "bg-success-lighter", border: "border-success-light", text: "text-success-text" },
            error: { bg: "bg-error-lighter", border: "border-error-light", text: "text-error-text" },
            warning: { bg: "bg-warning-lighter", border: "border-warning-light", text: "text-warning-text" },
            info: { bg: "bg-info-lighter", border: "border-info-light", text: "text-info-text" }
        };
        const theme = palette[variant] || palette.info;

        const toast = document.createElement("div");
        toast.id = "click-editor-toast";
        toast.className = `fixed bottom-4 left-4 z-[2000] max-w-[min(32rem,calc(100vw-1.5rem))] px-4 py-3 rounded-xl shadow-xl border ${theme.bg} ${theme.border} ${theme.text} flex items-start gap-3 animate-fade-in`;
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-[20px] mt-0.5 shrink-0";
        icon.textContent = variant === "error" ? "error" : (variant === "warning" ? "warning" : "check_circle");
        const content = document.createElement("div");
        content.className = "min-w-0 flex-1";
        const text = document.createElement("span");
        text.className = "text-sm font-medium leading-snug";
        text.textContent = message;
        content.appendChild(text);
        toast.appendChild(icon);
        toast.appendChild(content);
        const controls = document.createElement("div");
        controls.className = "flex items-start gap-2 shrink-0";

        let dismissed = false;
        const cleanup = () => {
            if (this.toastHideTimer) {
                clearTimeout(this.toastHideTimer);
                this.toastHideTimer = null;
            }
            this.toastDismissCallback = null;
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        };
        const dismiss = (reason = "timeout") => {
            if (dismissed) return;
            dismissed = true;
            toast.classList.add("opacity-0", "transition-opacity", "duration-300");
            this.toastDismissCallback = null;
            setTimeout(cleanup, 320);
            if (typeof options?.onDismiss === "function") {
                options.onDismiss(reason);
            }
        };

        if (options?.actionLabel && typeof options.onAction === "function") {
            const actionBtn = document.createElement("button");
            actionBtn.type = "button";
            actionBtn.className = "shrink-0 inline-flex items-center justify-center rounded-md border border-current/20 px-3 py-1.5 text-xs font-bold hover:bg-surface-1/70 transition-colors";
            actionBtn.setAttribute("data-toast-action", "undo");
            actionBtn.textContent = options.actionLabel;
            actionBtn.addEventListener("click", () => {
                if (dismissed) return;
                dismissed = true;
                this.toastDismissCallback = null;
                cleanup();
                options.onAction();
            });
            controls.appendChild(actionBtn);
        }

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "inline-flex h-7 w-7 items-center justify-center rounded-md border border-current/15 text-current/80 hover:bg-surface-1/70 hover:text-current transition-colors";
        closeBtn.setAttribute("data-toast-action", "close");
        closeBtn.setAttribute("aria-label", "Закрыть уведомление");
        closeBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">close</span>';
        closeBtn.addEventListener("click", () => dismiss("manual"));
        controls.appendChild(closeBtn);

        toast.appendChild(controls);

        document.body.appendChild(toast);
        this.toastDismissCallback = typeof options?.onDismiss === "function" ? options.onDismiss : null;
        this.toastHideTimer = setTimeout(() => dismiss("timeout"), duration);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof window !== 'undefined' && window.__CLICK_EDITOR_AUTO_INIT_DISABLED__) {
            return;
        }
        window.editor = new ClickEditor();
    });
}
