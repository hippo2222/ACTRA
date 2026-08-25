/**
 * ACTRA Image Labeling Editor
 */

class ImageLabelingEditor extends BaseEditor {
    constructor() {
        super();

        this.zones = [];
        this.selectedZoneIndex = null;

        // Zoom & Pan state
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;

        // Interaction state
        this.isPanning = false;
        this.isDrawing = false;
        this.isResizing = false;
        this.isDraggingZone = false;

        this.draggedZoneIndex = null;
        this.resizeHandleId = null; // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'

        this.dragStart = { x: 0, y: 0 };
        this.panStart = { x: 0, y: 0 };
        this.dragOffset = { x: 0, y: 0 };

        // Temp box dimensions (pixels relative to image original container)
        this.drawStart = { x: 0, y: 0 };
        this.currentBox = { x: 0, y: 0, w: 0, h: 0 };

        this.init();
    }

    async init() {
        await this.initTaskFromUrlContext();
        this.setupEventListeners();
    }

    /**
     * BaseEditor hook called after task is loaded
     */
    onTaskLoaded() {
        const content = this.task.task_data.content || {};
        this.zones = content.zones || [];
        this.renderUI();
        
        // Auto-fit image on load
        setTimeout(() => {
            this.resetZoom();
        }, 100);

        this.setupOnboardingPreviewStateSync();
    }

    setupOnboardingPreviewStateSync() {
        if (!this.isOnboardingPreview) return;

        const syncStep = (stepIndex) => {
            const hasImage = stepIndex >= 2;
            this.setPreviewImageState(hasImage);
        };

        window.addEventListener('onboarding:before-step', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId === 'image-labeling-authoring' && typeof detail.stepIndex === 'number') {
                syncStep(detail.stepIndex);
            }
        });

        const checkState = () => {
            const params = new URLSearchParams(window.location.search || '');
            const tourId = params.get('onboarding_preview') || params.get('onboarding_tour');
            if (tourId !== 'image-labeling-authoring') return;

            let stepIndex = 0;
            let hash = window.location.hash || '';
            try {
                if (!hash && window.parent && window.parent !== window) {
                    hash = window.parent.location.hash || '';
                }
            } catch (e) {
                // cross-origin fallback
            }

            const match = hash.match(/state-(\d+)/);
            if (match) {
                stepIndex = Math.max(0, parseInt(match[1], 10) - 1);
            } else if (params.has('onboarding_step')) {
                stepIndex = Math.max(0, parseInt(params.get('onboarding_step'), 10));
            } else if (params.has('onboarding_state')) {
                stepIndex = Math.max(0, parseInt(params.get('onboarding_state'), 10) - 1);
            } else if (params.has('step')) {
                stepIndex = Math.max(0, parseInt(params.get('step'), 10));
            } else if (window.OnboardingTour && typeof window.OnboardingTour.getCurrentStepIndex === 'function') {
                stepIndex = window.OnboardingTour.getCurrentStepIndex();
            }

            // Steps 0 & 1 (state-1 & state-2): Dropzone view (hasImage = false)
            // Steps 2, 3, 4 (state-3, state-4, state-5): Loaded leg diagram with 7 zones (hasImage = true)
            syncStep(stepIndex);
        };

        window.addEventListener('hashchange', checkState);
        window.addEventListener('popstate', checkState);
        checkState();
    }

    setPreviewImageState(hasImage) {
        if (this._currentPreviewHasImage === hasImage) return;
        this._currentPreviewHasImage = hasImage;

        const demoData = this.getDemoLegTaskData(hasImage);
        this.task = demoData;
        this.zones = demoData.task_data.content.zones || [];
        this.renderUI();
    }

    getDemoLegTaskData(hasImage = true) {
        return {
            metadata: {
                id: "task_6b008145",
                name: "Проверка"
            },
            task_data: {
                id: "task_6b008145",
                type: "image_labeling",
                name: "Проверка",
                meta: {
                    id: "task_6b008145",
                    module: "proverka_skhem",
                    topic: "proverochka",
                    title: "Проверка"
                },
                content: {
                    prompt: "Name the bones of a leg",
                    image: hasImage ? "/assets/image_labeling_demo_leg.png" : null,
                    zones: hasImage ? [
                        {
                            id: "zone_patella",
                            rect: { x: 62.67, y: 13.87, width: 22.81, height: 5.0 },
                            color: "#6366f1",
                            label: "Patella"
                        },
                        {
                            id: "zone_femur",
                            rect: { x: 60.72, y: 3.06, width: 25.34, height: 4.67 },
                            color: "#6366f1",
                            label: "Femur"
                        },
                        {
                            id: "zone_tibia",
                            rect: { x: 60.91, y: 23.38, width: 21.05, height: 5.96 },
                            color: "#6366f1",
                            label: "Tibia"
                        },
                        {
                            id: "zone_fibula",
                            rect: { x: 61.89, y: 37.58, width: 27.10, height: 4.83 },
                            color: "#f2f2f2",
                            label: "Fibula"
                        },
                        {
                            id: "zone_tarsals",
                            rect: { x: 63.64, y: 73.70, width: 20.86, height: 4.67 },
                            color: "#6366f1",
                            label: "Tarsals"
                        },
                        {
                            id: "zone_metatarsals",
                            rect: { x: 64.42, y: 81.29, width: 29.24, height: 4.03 },
                            color: "#6366f1",
                            label: "Metatarsals"
                        },
                        {
                            id: "zone_phalanges",
                            rect: { x: 67.35, y: 88.54, width: 24.17, height: 5.64 },
                            color: "#e60000",
                            label: "Phalanges"
                        }
                    ] : []
                }
            },
            settings: {
                difficulty: 1
            }
        };
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

    buildTaskData() {
        const prompt = document.querySelector('#prompt-textarea')?.value || '';

        return {
            type: 'image_labeling',
            name: this.task?.task_data?.name || wt('image_labeling_editor.default_name', 'Подписи на рисунке'),
            content: {
                prompt: prompt,
                image: this.task?.task_data?.content?.image || null,
                zones: this.zones
            },
            settings: this.task?.task_data?.settings || {
                difficulty_level: 1,
                case_sensitive: false,
                allow_hints: true
            }
        };
    }

    validateTask() {
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";
        if (!prompt) {
            if (promptArea) promptArea.focus();
            return wt('image_labeling_editor.err_empty_prompt', 'Пожалуйста, введите формулировку задания');
        }

        const data = this.buildTaskData();
        if (!data.content.image) {
            return wt('image_labeling_editor.err_empty_image', 'Пожалуйста, загрузите изображение для задания');
        }
        if (this.zones.length === 0) {
            return wt('image_labeling_editor.err_no_zones', 'Необходимо разметить хотя бы одну область на рисунке');
        }
        
        // Check for empty labels
        const emptyZoneIndex = this.zones.findIndex(z => !String(z.label || '').trim());
        if (emptyZoneIndex !== -1) {
            this.selectedZoneIndex = emptyZoneIndex;
            this.renderUI();
            const rawTemplate = wt('image_labeling_editor.err_empty_zone_label', 'Область #{index} имеет пустую подпись');
            return rawTemplate.replace('{index}', emptyZoneIndex + 1);
        }
        return null;
    }

    getDifficultyAuthoringMountPoint() {
        return document.querySelector('#editor-difficulty-authoring-mount')
            || document.querySelector('#editor-difficulty-authoring');
    }

    getDifficultyAuthoringLayoutVariant() {
        return 'sidebar-compact';
    }

    getDifficultyAuthoringInsertMode() {
        return 'append';
    }

    captureState() {
        return {
            zones: JSON.parse(JSON.stringify(this.zones)),
            selectedZoneIndex: this.selectedZoneIndex,
            prompt: document.querySelector('#prompt-textarea')?.value || '',
            image: this.task?.task_data?.content?.image || null,
            taskSettings: this.captureTaskSettingsState()
        };
    }

    restoreState(state) {
        if (!state) return;
        this.zones = state.zones || [];
        this.selectedZoneIndex = state.selectedZoneIndex;
        
        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) promptArea.value = state.prompt || '';
        
        if (this.task && this.task.task_data && this.task.task_data.content) {
            this.task.task_data.content.image = state.image || null;
            this.task.task_data.content.prompt = state.prompt || '';
        }

        if (state.taskSettings) {
            this.restoreTaskSettingsState(state.taskSettings);
        }

        this.renderUI();
    }

    renderUI() {
        if (!this.task) return;

        // Title and prompt text
        this.updateTaskTitleDisplay();
        
        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea && this.task.task_data.content) {
            promptArea.value = this.task.task_data.content.prompt || '';
        }



        // Image container and dropzone visibility
        const dropzone = document.querySelector('#image-dropzone');
        const viewport = document.querySelector('#image-viewport');
        const replaceImageBtn = document.querySelector('#replace-image-btn');
        const img = document.querySelector('#main-image');

        const imageSrc = this.resolveEditorImagePreviewSrc(this.task.task_data.content.image);
        
        if (imageSrc) {
            dropzone.classList.add('hidden');
            viewport.classList.remove('hidden');
            replaceImageBtn.classList.remove('hidden');
            
            const onLoaded = () => {
                setTimeout(() => {
                    this.updateCanvasBounds();
                    this.resetZoom();
                    this.renderZones();
                }, 50);
            };

            const fullSrc = new URL(imageSrc, window.location.href).href;
            if (img.src !== fullSrc) {
                img.onload = onLoaded;
                img.src = imageSrc;
            }
            if (img.complete && img.naturalWidth > 0) {
                onLoaded();
            }
        } else {
            dropzone.classList.remove('hidden');
            viewport.classList.add('hidden');
            replaceImageBtn.classList.add('hidden');
        }

        this.renderSidebarZonesList();
    }

    getTaskDisplayName() {
        if (!this.task) return wt('image_labeling_editor.new_task', 'Новое задание');
        const taskData = this.task.task_data || {};
        const meta = taskData.meta || {};
        const metadata = this.task.metadata || {};
        return (
            taskData.name ||
            taskData.title ||
            meta.title ||
            meta.name ||
            metadata.title ||
            metadata.name ||
            metadata.id ||
            meta.id ||
            wt('image_labeling_editor.new_task', 'Новое задание')
        );
    }

    updateTaskTitleDisplay() {
        const titleSpan = document.querySelector('#task-title-display');
        if (titleSpan) {
            titleSpan.textContent = this.getTaskDisplayName();
        }
    }

    updateCanvasBounds() {
        const img = document.querySelector('#main-image');
        const canvas = document.querySelector('#canvas-container');
        if (!img || !canvas) return;

        canvas.style.width = `${img.clientWidth}px`;
        canvas.style.height = `${img.clientHeight}px`;
    }

    renderZones() {
        const svg = document.querySelector('#annotation-svg');
        const img = document.querySelector('#main-image');
        if (!svg || !img || !img.clientWidth) return;

        svg.innerHTML = '';
        const width = img.clientWidth;
        const height = img.clientHeight;

        const getContrastColor = (hexColor) => {
            if (!hexColor || hexColor.toLowerCase() === '#ffffff') return '#0f172a';
            const hex = hexColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            if (isNaN(r) || isNaN(g) || isNaN(b)) return '#0f172a';
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#0f172a' : '#ffffff';
        };

        this.zones.forEach((zone, index) => {
            const isSelected = this.selectedZoneIndex === index;
            const rectPx = {
                x: (zone.rect.x / 100) * width,
                y: (zone.rect.y / 100) * height,
                w: (zone.rect.width / 100) * width,
                h: (zone.rect.height / 100) * height
            };

            // Group container for zone SVG elements
            const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
            group.setAttribute("data-index", index);
            svg.appendChild(group); // Append early so we can measure elements!

            // 1. Draw Rect
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", rectPx.x);
            rect.setAttribute("y", rectPx.y);
            rect.setAttribute("width", rectPx.w);
            rect.setAttribute("height", rectPx.h);
            rect.setAttribute("class", `svg-zone-rect ${isSelected ? 'selected' : ''}`);
            
            const baseColor = zone.color || '#ffffff';
            rect.setAttribute("fill", baseColor);
            rect.setAttribute("stroke", baseColor === '#ffffff' ? '#cbd5e1' : baseColor);
            
            // Interaction on rect click
            rect.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                const before = this.captureTaskSnapshot();
                this.selectedZoneIndex = index;
                this.renderSidebarZonesList();
                this.renderZones(); // update selection classes

                if (e.button === 0) { // left click drag
                    this.isDraggingZone = true;
                    this.draggedZoneIndex = index;
                    const focal = this.getRelativeMousePosition(e);
                    this.dragOffset = {
                        x: focal.x - rectPx.x,
                        y: focal.y - rectPx.y
                    };
                }
                this.handlePotentialChange(before);
            });

            group.appendChild(rect);

            // 2. Draw Text Label
            if (zone.label) {
                const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
                fo.setAttribute("x", rectPx.x + 4);
                fo.setAttribute("y", rectPx.y + 4);
                
                const maxW = Math.max(10, rectPx.w - 8);
                const maxH = Math.max(10, rectPx.h - 8);
                fo.setAttribute("width", maxW);
                fo.setAttribute("height", maxH);
                fo.setAttribute("style", "pointer-events: none;");

                const div = document.createElement("div");
                div.setAttribute("style", `
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    word-break: break-word;
                    white-space: normal;
                    line-height: 1.1;
                    font-family: inherit;
                    font-weight: 600;
                    color: ${getContrastColor(baseColor)};
                `);

                div.textContent = zone.label;
                fo.appendChild(div);
                group.appendChild(fo);

                // Auto-fit font-size loop: decrease fs if it overflows maxH
                let fs = Math.max(10, Math.min(32, rectPx.h * 0.75));
                div.style.fontSize = `${fs}px`;
                div.style.height = 'auto'; // Temp auto-height to measure scrollHeight
                
                while (fs > 8 && div.scrollHeight > maxH) {
                    fs -= 0.5;
                    div.style.fontSize = `${fs}px`;
                }
                
                // Set height back to 100% so display: flex centers it vertically
                div.style.height = '100%';
            }

            // 3. Draw Resize Handles if selected
            if (isSelected) {
                const handlePositions = [
                    { id: 'nw', x: rectPx.x, y: rectPx.y },
                    { id: 'n',  x: rectPx.x + rectPx.w / 2, y: rectPx.y },
                    { id: 'ne', x: rectPx.x + rectPx.w, y: rectPx.y },
                    { id: 'e',  x: rectPx.x + rectPx.w, y: rectPx.y + rectPx.h / 2 },
                    { id: 'se', x: rectPx.x + rectPx.w, y: rectPx.y + rectPx.h },
                    { id: 's',  x: rectPx.x + rectPx.w / 2, y: rectPx.y + rectPx.h },
                    { id: 'sw', x: rectPx.x, y: rectPx.y + rectPx.h },
                    { id: 'w',  x: rectPx.x, y: rectPx.y + rectPx.h / 2 }
                ];

                handlePositions.forEach(pos => {
                    const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    handle.setAttribute("cx", pos.x);
                    handle.setAttribute("cy", pos.y);
                    handle.setAttribute("r", 6);
                    handle.setAttribute("class", "resize-handle");
                    
                    let cursor = 'move';
                    if (pos.id === 'nw' || pos.id === 'se') cursor = 'nwse-resize';
                    if (pos.id === 'ne' || pos.id === 'sw') cursor = 'nesw-resize';
                    if (pos.id === 'w' || pos.id === 'e') cursor = 'ew-resize';
                    if (pos.id === 'n' || pos.id === 's') cursor = 'ns-resize';
                    handle.style.cursor = cursor;

                    handle.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this.isResizing = true;
                        this.resizeHandleId = pos.id;
                        this.draggedZoneIndex = index;
                        this.dragStart = this.getRelativeMousePosition(e);
                        // Save original rect dimensions in pixels
                        this.origRectPx = { ...rectPx };
                    });

                    group.appendChild(handle);
                });
            }
        });
    }

    renderSidebarZonesList() {
        const container = document.querySelector('#zones-list-container');
        const noZonesMsg = document.querySelector('#no-zones-message');
        const badge = document.querySelector('#zone-count-badge');
        if (!container) return;

        container.innerHTML = '';
        
        if (badge) {
            badge.textContent = this.zones.length;
        }

        if (this.zones.length === 0) {
            if (noZonesMsg) noZonesMsg.classList.remove('hidden');
            return;
        }

        if (noZonesMsg) noZonesMsg.classList.add('hidden');

        this.zones.forEach((zone, index) => {
            const isSelected = this.selectedZoneIndex === index;
            const card = document.createElement('div');
            card.className = `zone-card ${isSelected ? 'selected' : ''}`;
            card.setAttribute('data-index', index);

            card.innerHTML = `
                <div class="zone-card-header">
                    <span class="text-xs font-bold text-text-secondary flex items-center gap-1.5">
                        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-3 text-[10px] font-bold text-text-main">${index + 1}</span>
                        <span>${wt('image_labeling_editor.zone_label', 'Область')}</span>
                    </span>
                    <button class="delete-zone-btn p-1 text-text-disabled hover:text-error transition-colors rounded hover:bg-bg-hover" title="${wt('image_labeling_editor.delete_zone', 'Удалить область')}">
                        <span class="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                </div>
                <div class="flex gap-2">
                    <input type="text" value="${zone.label || ''}" placeholder="${wt('image_labeling_editor.zone_placeholder', 'Название подписи...')}"
                        class="zone-label-input flex-1 min-w-0 rounded-lg border-border-subtle bg-surface-3 py-1.5 px-3 text-xs text-text-main placeholder:text-text-disabled focus:ring-1 focus:ring-primary focus:border-primary" />
                    <input type="color" value="${zone.color || '#6366f1'}"
                        class="zone-color-input w-8 h-8 rounded-lg border border-border-subtle bg-transparent p-0.5 cursor-pointer" title="${wt('image_labeling_editor.border_color', 'Цвет рамки')}" />
                </div>
            `;

            // Interactions
            card.addEventListener('click', () => {
                if (this.selectedZoneIndex !== index) {
                    this.selectedZoneIndex = index;
                    this.renderZones();
                    this.renderSidebarZonesList();
                }
            });

            const labelInput = card.querySelector('.zone-label-input');
            labelInput.addEventListener('input', (e) => {
                const val = e.target.value;
                this.zones[index].label = val;
                this.markUnsaved();
                this.renderZones();
            });

            const colorInput = card.querySelector('.zone-color-input');
            colorInput.addEventListener('input', (e) => {
                const val = e.target.value;
                this.zones[index].color = val;
                this.markUnsaved();
                this.renderZones();
            });

            const deleteBtn = card.querySelector('.delete-zone-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const before = this.captureTaskSnapshot();
                this.zones.splice(index, 1);
                this.selectedZoneIndex = null;
                this.markUnsaved();
                this.renderUI();
                this.handlePotentialChange(before);
            });

            container.appendChild(card);
            
            // Focus on label input if just selected and label is empty
            if (isSelected && !zone.label) {
                setTimeout(() => {
                    labelInput.focus();
                }, 50);
            }
        });
    }

    captureTaskSnapshot() {
        if (!this.task) return null;
        const prompt = document.querySelector('#prompt-textarea')?.value || '';
        const level = document.querySelector('input[name="difficulty-level"]:checked')?.value || '1';
        const image = JSON.stringify(this.task.task_data.content.image || null);
        const zones = JSON.stringify(this.zones);
        return `${prompt}|${level}|${image}|${zones}`;
    }

    handlePotentialChange(previousSnapshot, options = {}) {
        if (!previousSnapshot) return;
        const currentSnapshot = this.captureTaskSnapshot();
        if (currentSnapshot !== previousSnapshot) {
            this.markUnsaved();
        }
    }

    setupEventListeners() {
        const titleDisplay = document.querySelector('#task-title-display');
        if (titleDisplay) {
            this.setupHeaderRenameTrigger(titleDisplay, {
                onSuccess: () => this.updateTaskTitleDisplay()
            });
        }

        // Back to library button
        const backBtn = document.querySelector('#back-to-dashboard-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.goBack();
            });
        }

        // Image dropzone interaction
        const dropzone = document.querySelector('#image-dropzone');
        const fileInput = document.querySelector('#image-file-input');
        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('border-primary');
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('border-primary');
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('border-primary');
                const file = e.dataTransfer.files[0];
                if (file) {
                    this.uploadImageFile(file);
                }
            });
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.uploadImageFile(file);
                }
            });
        }

        // Replace Image button
        const replaceBtn = document.querySelector('#replace-image-btn');
        if (replaceBtn) {
            replaceBtn.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        this.uploadImageFile(file);
                    }
                };
                input.click();
            });
        }

        // Zoom buttons
        document.querySelector('#zoom-in-btn')?.addEventListener('click', () => this.adjustZoom(1));
        document.querySelector('#zoom-out-btn')?.addEventListener('click', () => this.adjustZoom(-1));
        document.querySelector('#zoom-reset-btn')?.addEventListener('click', () => this.resetZoom());

        // Viewport mouse interactions
        const viewport = document.querySelector('#image-viewport');
        const svg = document.querySelector('#annotation-svg');
        const container = document.querySelector('#canvas-container');

        if (svg) {
            svg.addEventListener('mousedown', (e) => {
                const focal = this.getRelativeMousePosition(e);
                const before = this.captureTaskSnapshot();

                if (e.button === 1 || e.button === 2 || e.shiftKey) { // Pan mode (middle click, right click, or Shift+left click)
                    e.preventDefault();
                    this.isPanning = true;
                    this.panStart = { x: e.clientX, y: e.clientY };
                } else if (e.button === 0) { // Drawing box mode
                    this.isDrawing = true;
                    this.drawStart = { x: focal.x, y: focal.y };
                    this.currentBox = { x: focal.x, y: focal.y, w: 0, h: 0 };
                    
                    // Create temp SVG rect
                    this.tempRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    this.tempRect.setAttribute("x", focal.x);
                    this.tempRect.setAttribute("y", focal.y);
                    this.tempRect.setAttribute("width", 0);
                    this.tempRect.setAttribute("height", 0);
                    this.tempRect.setAttribute("fill", "#6366f1");
                    this.tempRect.setAttribute("fill-opacity", "0.2");
                    this.tempRect.setAttribute("stroke", "#6366f1");
                    this.tempRect.setAttribute("stroke-width", "2");
                    this.tempRect.setAttribute("stroke-dasharray", "4 4");
                    svg.appendChild(this.tempRect);
                }
                this.handlePotentialChange(before);
            });

            // Prevent right click menu on canvas to allow panning
            svg.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        }

        window.addEventListener('mousemove', (e) => {
            const before = this.captureTaskSnapshot();
            
            if (this.isPanning) {
                const dx = e.clientX - this.panStart.x;
                const dy = e.clientY - this.panStart.y;
                this.panX += dx;
                this.panY += dy;
                this.panStart = { x: e.clientX, y: e.clientY };
                this.updateTransform();
            } else if (this.isDrawing && this.tempRect) {
                const focal = this.getRelativeMousePosition(e);
                const x1 = Math.min(this.drawStart.x, focal.x);
                const y1 = Math.min(this.drawStart.y, focal.y);
                const x2 = Math.max(this.drawStart.x, focal.x);
                const y2 = Math.max(this.drawStart.y, focal.y);
                
                // Clamp coordinates to image width/height bounds
                const img = document.querySelector('#main-image');
                const xClamped1 = Math.max(0, Math.min(img.clientWidth, x1));
                const yClamped1 = Math.max(0, Math.min(img.clientHeight, y1));
                const xClamped2 = Math.max(0, Math.min(img.clientWidth, x2));
                const yClamped2 = Math.max(0, Math.min(img.clientHeight, y2));

                this.currentBox = {
                    x: xClamped1,
                    y: yClamped1,
                    w: xClamped2 - xClamped1,
                    h: yClamped2 - yClamped1
                };

                this.tempRect.setAttribute("x", this.currentBox.x);
                this.tempRect.setAttribute("y", this.currentBox.y);
                this.tempRect.setAttribute("width", this.currentBox.w);
                this.tempRect.setAttribute("height", this.currentBox.h);
            } else if (this.isDraggingZone && this.draggedZoneIndex !== null) {
                const focal = this.getRelativeMousePosition(e);
                const img = document.querySelector('#main-image');
                const zone = this.zones[this.draggedZoneIndex];
                
                // New pixel x, y
                let pxX = focal.x - this.dragOffset.x;
                let pxY = focal.y - this.dragOffset.y;

                const widthPx = (zone.rect.width / 100) * img.clientWidth;
                const heightPx = (zone.rect.height / 100) * img.clientHeight;

                // Clamp to canvas bounds
                pxX = Math.max(0, Math.min(img.clientWidth - widthPx, pxX));
                pxY = Math.max(0, Math.min(img.clientHeight - heightPx, pxY));

                zone.rect.x = (pxX / img.clientWidth) * 100;
                zone.rect.y = (pxY / img.clientHeight) * 100;

                this.markUnsaved();
                this.renderZones();
            } else if (this.isResizing && this.draggedZoneIndex !== null) {
                const focal = this.getRelativeMousePosition(e);
                const img = document.querySelector('#main-image');
                const zone = this.zones[this.draggedZoneIndex];

                const deltaX = focal.x - this.dragStart.x;
                const deltaY = focal.y - this.dragStart.y;

                let newX = this.origRectPx.x;
                let newY = this.origRectPx.y;
                let newW = this.origRectPx.w;
                let newH = this.origRectPx.h;

                const minSize = 15; // minimum physical pixel size

                switch (this.resizeHandleId) {
                    case 'se':
                        newW = Math.max(minSize, this.origRectPx.w + deltaX);
                        newH = Math.max(minSize, this.origRectPx.h + deltaY);
                        break;
                    case 'sw':
                        newW = Math.max(minSize, this.origRectPx.w - deltaX);
                        if (newW > minSize) newX = this.origRectPx.x + deltaX;
                        newH = Math.max(minSize, this.origRectPx.h + deltaY);
                        break;
                    case 'ne':
                        newW = Math.max(minSize, this.origRectPx.w + deltaX);
                        newH = Math.max(minSize, this.origRectPx.h - deltaY);
                        if (newH > minSize) newY = this.origRectPx.y + deltaY;
                        break;
                    case 'nw':
                        newW = Math.max(minSize, this.origRectPx.w - deltaX);
                        if (newW > minSize) newX = this.origRectPx.x + deltaX;
                        newH = Math.max(minSize, this.origRectPx.h - deltaY);
                        if (newH > minSize) newY = this.origRectPx.y + deltaY;
                        break;
                    case 'e':
                        newW = Math.max(minSize, this.origRectPx.w + deltaX);
                        break;
                    case 'w':
                        newW = Math.max(minSize, this.origRectPx.w - deltaX);
                        if (newW > minSize) newX = this.origRectPx.x + deltaX;
                        break;
                    case 's':
                        newH = Math.max(minSize, this.origRectPx.h + deltaY);
                        break;
                    case 'n':
                        newH = Math.max(minSize, this.origRectPx.h - deltaY);
                        if (newH > minSize) newY = this.origRectPx.y + deltaY;
                        break;
                }

                // Clamp to canvas bounds
                if (newX < 0) {
                    newW += newX;
                    newX = 0;
                }
                if (newY < 0) {
                    newH += newY;
                    newY = 0;
                }
                if (newX + newW > img.clientWidth) {
                    newW = img.clientWidth - newX;
                }
                if (newY + newH > img.clientHeight) {
                    newH = img.clientHeight - newY;
                }

                zone.rect.x = (newX / img.clientWidth) * 100;
                zone.rect.y = (newY / img.clientHeight) * 100;
                zone.rect.width = (newW / img.clientWidth) * 100;
                zone.rect.height = (newH / img.clientHeight) * 100;

                this.markUnsaved();
                this.renderZones();
            }

            this.handlePotentialChange(before, { skipIfSame: true });
        });

        window.addEventListener('mouseup', (e) => {
            const before = this.captureTaskSnapshot();
            
            if (this.isPanning) {
                this.isPanning = false;
            } else if (this.isDrawing && this.tempRect) {
                this.isDrawing = false;
                svg.removeChild(this.tempRect);
                this.tempRect = null;

                const img = document.querySelector('#main-image');
                
                // Only create zone if size is above small threshold (prevent accidental clicks)
                if (this.currentBox.w > 10 && this.currentBox.h > 10) {
                    const newZone = {
                        id: this.generateId('zone'),
                        label: '',
                        color: '#6366f1',
                        rect: {
                            x: (this.currentBox.x / img.clientWidth) * 100,
                            y: (this.currentBox.y / img.clientHeight) * 100,
                            width: (this.currentBox.w / img.clientWidth) * 100,
                            height: (this.currentBox.h / img.clientHeight) * 100
                        }
                    };
                    this.zones.push(newZone);
                    this.selectedZoneIndex = this.zones.length - 1;
                    this.markUnsaved();
                    this.renderUI();
                }
            } else if (this.isDraggingZone) {
                this.isDraggingZone = false;
                this.draggedZoneIndex = null;
            } else if (this.isResizing) {
                this.isResizing = false;
                this.draggedZoneIndex = null;
                this.resizeHandleId = null;
            }

            this.handlePotentialChange(before);
        });

        // Wheel zoom
        viewport?.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const focal = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            const zoomFactor = e.deltaY > 0 ? -0.1 : 0.1;
            this.adjustZoom(zoomFactor, focal);
        }, { passive: false });

        // Sidebar Prompt textarea interaction
        document.querySelector('#prompt-textarea')?.addEventListener('input', () => {
            this.markUnsaved();
        });

        // Save Button click
        document.querySelector('#save-task-btn')?.addEventListener('click', () => {
            this.saveTask();
        });

        // Clipboard Paste interaction
        document.addEventListener('paste', (e) => {
            this.handleClipboardPaste(e).catch((error) => {
                console.error('Clipboard image paste failed', error);
                this.showToast(error.message || wt('image_labeling_editor.paste_error', 'Не удалось вставить изображение'), 'error');
            });
        });

        // Sidebar Resizer interaction
        const resizer = document.querySelector('#sidebar-resizer');
        const sidebar = document.querySelector('#editor-sidebar');
        if (resizer && sidebar) {
            let isResizingSidebar = false;

            resizer.addEventListener('mousedown', (e) => {
                isResizingSidebar = true;
                document.body.style.cursor = 'col-resize';
                document.body.classList.add('select-none');
                e.preventDefault();
            });

            window.addEventListener('mousemove', (e) => {
                if (!isResizingSidebar) return;
                const newWidth = window.innerWidth - e.clientX;
                const clampedWidth = Math.max(260, Math.min(600, newWidth));
                sidebar.style.width = `${clampedWidth}px`;
                this.updateCanvasBounds();
                this.resetZoom();
            });

            window.addEventListener('mouseup', () => {
                if (isResizingSidebar) {
                    isResizingSidebar = false;
                    document.body.style.cursor = '';
                    document.body.classList.remove('select-none');
                }
            });
        }

        // Window resize listener
        window.addEventListener('resize', () => {
            if (document.querySelector('#main-image')?.clientWidth) {
                this.updateCanvasBounds();
                this.resetZoom();
            }
        });
    }

    getRelativeMousePosition(event) {
        const container = document.querySelector('#canvas-container');
        const rect = container.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / this.zoomLevel,
            y: (event.clientY - rect.top) / this.zoomLevel
        };
    }

    adjustZoom(zoomFactorOrDirection, focal = null) {
        const viewport = document.querySelector('#image-viewport');
        const container = document.querySelector('#canvas-container');
        if (!viewport || !container) return;

        const beforeZoom = this.zoomLevel;
        let scaleChange = 0.15;
        
        if (Math.abs(zoomFactorOrDirection) === 1) { // Zoom button clicked
            this.zoomLevel += (zoomFactorOrDirection > 0 ? scaleChange : -scaleChange);
        } else { // Wheel zoomed
            this.zoomLevel += zoomFactorOrDirection;
        }

        // Clamp zoom level
        this.zoomLevel = Math.max(0.1, Math.min(8.0, this.zoomLevel));

        if (Math.abs(beforeZoom - this.zoomLevel) < 0.0001) return;

        if (!focal) {
            focal = {
                x: viewport.clientWidth / 2,
                y: viewport.clientHeight / 2
            };
        }

        // Adjust pan to zoom on focal point
        const worldX = (focal.x - this.panX) / beforeZoom;
        const worldY = (focal.y - this.panY) / beforeZoom;
        this.panX = focal.x - worldX * this.zoomLevel;
        this.panY = focal.y - worldY * this.zoomLevel;

        this.updateTransform();
    }

    resetZoom() {
        const viewport = document.querySelector('#image-viewport');
        const img = document.querySelector('#main-image');
        if (!viewport || !img || !img.clientWidth) return;

        // Auto-scale to fit window
        const scaleX = (viewport.clientWidth - 48) / img.clientWidth;
        const scaleY = (viewport.clientHeight - 48) / img.clientHeight;
        this.zoomLevel = Math.min(1.0, scaleX, scaleY);
        
        // Centered panning (flexbox handles alignment, so base pan offset is 0)
        this.panX = 0;
        this.panY = 0;

        this.updateTransform();
    }

    updateTransform() {
        const container = document.querySelector('#canvas-container');
        const display = document.querySelector('#zoom-value');
        if (container) {
            container.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
        }
        if (display) {
            display.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }

        
        // Re-render SVG to adjust handles if needed
        this.renderZones();
    }

    async uploadImageFile(file) {
        const hasImage = this.task && this.task.task_data && this.task.task_data.content && this.task.task_data.content.image;
        if (hasImage) {
            const confirmed = await NotificationUI.confirm({
                title: wt('image_labeling_editor.replace_title', 'Замена изображения'),
                message: wt('image_labeling_editor.replace_message', 'Вы уверены, что хотите заменить текущее изображение?\nЭто удалит все размеченные области на рисунке.'),
                confirmText: wt('image_labeling_editor.replace_confirm', 'Заменить'),
                cancelText: wt('image_labeling_editor.replace_cancel', 'Отмена'),
                variant: 'error'
            });
            if (!confirmed) return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('module', this.moduleId);
        formData.append('topic', this.topicId);
        formData.append('task', this.taskId);

        try {
            const response = await fetch('/api/editor/upload-image', {
                method: 'POST',
                body: formData
            });

            if (response.status === 413) {
                this.showToast(wt('image_labeling_editor.file_too_large', 'Размер файла слишком велик. Выберите файл поменьше.'), 'error');
                return;
            }

            if (!response.ok) {
                const uploadFailedTemplate = wt('image_labeling_editor.upload_failed_status', 'Загрузка не удалась: {status}');
                this.showToast(uploadFailedTemplate.replace('{status}', response.statusText), 'error');
                return;
            }

            const data = await response.json();
            if (data.ok && (data.path || data.asset_id || data.asset_url)) {
                this.showToast(wt('image_labeling_editor.upload_success', 'Изображение успешно загружено'), 'success');
                const before = this.captureTaskSnapshot();
                this.task.task_data.content.image = this.serializeImageReference({
                    path: data.path,
                    asset_id: data.asset_id,
                    asset_url: data.asset_url
                }) || data.path;
                
                // Очищаем старые области разметки, так как они относились к старому рисунку
                this.zones = [];
                
                this.markUnsaved();
                this.renderUI();
                
                // Auto-fit after loading new image
                setTimeout(() => {
                    this.resetZoom();
                }, 100);

                this.handlePotentialChange(before);
            } else {
                const uploadErrorTemplate = wt('image_labeling_editor.upload_failed_error', 'Ошибка загрузки: {error}');
                this.showToast(uploadErrorTemplate.replace('{error}', data.error || 'unknown'), 'error');
            }
        } catch (err) {
            console.error('Error uploading image:', err);
            this.showToast(wt('image_labeling_editor.upload_generic_error', 'Произошла ошибка при загрузке изображения'), 'error');
        }
    }

    shouldSuppressImagePasteForElement(element) {
        if (!element || element.nodeType !== 1 || typeof element.closest !== 'function') {
            return false;
        }
        if (element.closest('.modal') || element.closest('[role="dialog"]')) {
            return true;
        }
        return false;
    }

    async handleClipboardPaste(event) {
        const eventTarget = event?.target?.nodeType === 1 ? event.target : document.activeElement;
        if (this.shouldSuppressImagePasteForElement(eventTarget)) {
            return;
        }

        const imageFile = await this.extractImageFileFromClipboardEvent(event);
        if (!imageFile) return;

        event.preventDefault();

        await this.uploadImageFile(imageFile);
    }
}

// Instantiate the editor on page load
window.addEventListener('DOMContentLoaded', () => {
    window.imageLabelingEditor = new ImageLabelingEditor();
});
