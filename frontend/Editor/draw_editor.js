/**
 * ACTRA Draw Task Editor (Region Segmentation)
 */

class DrawEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task is now inherited from BaseEditor

        // Draw Editor specific fields
        this.regions = [];
        this.selectedRegionIndex = -1;
        this.isDrawing = false;
        this.currentPolygon = null; // Points for polygon currently being drawn

        this.init();
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

    async init() {
        await this.initTaskFromUrlContext();
        this.setupEventListeners();
    }

    /**
     * Called after task is loaded from backend (BaseEditor hook)
     */
    onTaskLoaded() {
        this.regions = this.task.task_data.content.regions || [];
        this.renderUI();
    }

    renderUI() {
        if (!this.task) return;

        // Header and metadata
        const headerSpan = document.querySelector('header h2 span');
        if (headerSpan) headerSpan.textContent = this.task.task_data.name || (this.task.metadata && this.task.metadata.id) || '';

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) promptArea.value = this.task.task_data.content.prompt || "";

        const correctInput = document.querySelector('#required-correct-input');
        if (correctInput) correctInput.value = this.task.task_data.content.required_correct || 1;

        // Image
        const img = document.querySelector('#main-image');
        const placeholder = document.querySelector('#image-placeholder');
        const svg = document.querySelector('#annotation-svg');

        if (img && this.task.task_data.content.image) {
            if (placeholder) placeholder.classList.add('hidden');
            img.classList.remove('hidden');
            if (svg) svg.classList.remove('hidden');
            const imgPath = this.task.task_data.content.image;
            img.src = `/api/editor/image?path=${encodeURIComponent(imgPath)}`;
            img.onload = () => {
                this.renderRegions();
            };
        } else if (img) {
            img.classList.add('hidden');
            if (svg) svg.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
        }

        this.renderRegionList();
    }

    renderRegions() {
        const svg = document.querySelector('#annotation-svg');
        const handlesContainer = document.querySelector('#vertex-handles');
        if (!svg || !handlesContainer) return;

        svg.innerHTML = '';
        handlesContainer.innerHTML = '';

        const img = document.querySelector('#main-image');
        const rect = img.getBoundingClientRect();
        const { width, height } = rect;

        this.regions.forEach((region, index) => {
            const isSelected = this.selectedRegionIndex === index;

            // Create Polygon
            const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            const pointsStr = region.points.map(p => `${(p[0] / 100) * width},${(p[1] / 100) * height}`).join(' ');

            polygon.setAttribute("points", pointsStr);
            polygon.setAttribute("class", "region-polygon animate-scale-in transition-all");
            polygon.setAttribute("fill", isSelected ? "var(--color-primary-light)" : "var(--color-primary-lighter)");
            polygon.setAttribute("fill-opacity", isSelected ? "0.4" : "0.25");
            polygon.setAttribute("stroke", isSelected ? "var(--color-primary)" : "var(--color-primary-light)");
            polygon.setAttribute("stroke-width", isSelected ? "3" : "2");
            polygon.style.transformOrigin = "center";
            polygon.style.transition = "all 0.3s ease";

            polygon.onclick = (e) => {
                e.stopPropagation();
                this.selectRegion(index);
            };

            svg.appendChild(polygon);

            // Create Handles if selected
            if (isSelected) {
                region.points.forEach((p, vIndex) => {
                    const handle = document.createElement('div');
                    handle.className = 'vertex-handle animate-pop-in';
                    handle.style.left = `${(p[0] / 100) * width}px`;
                    handle.style.top = `${(p[1] / 100) * height}px`;

                    handle.onmousedown = (e) => {
                        e.stopPropagation();
                        this.startDraggingVertex(index, vIndex);
                    };

                    handlesContainer.appendChild(handle);
                });
            }
        });
    }

    renderRegionList() {
        const list = document.querySelector('#region-list');
        if (!list) return;
        list.innerHTML = '';

        this.regions.forEach((region, index) => {
            const isSelected = this.selectedRegionIndex === index;
            const div = document.createElement('div');
            div.dataset.regionIndex = String(index);
            div.className = `group flex items-center gap-3 p-2.5 rounded-lg transition-all cursor-pointer relative overflow-hidden ${isSelected ? 'bg-primary-lighter border border-primary-light shadow-sm' : 'bg-surface-1 border border-border-subtle hover:border-border-strong'}`;

            if (isSelected) {
                div.innerHTML = `<div class="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>`;
            }

            div.innerHTML += `
                <div class="w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-success' : 'bg-primary'} shrink-0 ring-2 ring-surface-2"></div>
                <div class="flex-1 min-w-0">
                    <div class="text-[10px] ${isSelected ? 'text-primary' : 'text-text-disabled'} uppercase font-bold mb-0.5">Region ${index + 1}</div>
                    <input class="w-full bg-transparent border-none p-0 text-sm font-medium text-text-main focus:ring-0 truncate" type="text"/>
                </div>
                <button class="text-text-disabled hover:text-error transition-colors p-1 rounded hover:bg-error-lighter">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
            `;

            div.onclick = (e) => {
                if (e.target.closest('input,button')) return;
                this.selectRegion(index);
            };

            const input = div.querySelector('input');
            input.value = region.label || '';
            input.onpointerdown = (e) => {
                e.stopPropagation();
                if (this.selectedRegionIndex !== index) {
                    e.preventDefault();
                    this.selectRegion(index);
                    this.focusRegionLabelInput(index);
                }
            };
            input.onclick = (e) => e.stopPropagation();
            input.onfocus = (e) => e.stopPropagation();
            input.onkeydown = (e) => e.stopPropagation();
            input.oninput = (e) => {
                this.regions[index].label = e.target.value;
                this.markUnsaved();
            };

            div.querySelector('button').onclick = (e) => {
                e.stopPropagation();
                this.deleteRegion(index);
            };

            list.appendChild(div);
        });

        this.renderVertexEditor();
    }

    focusRegionLabelInput(index) {
        requestAnimationFrame(() => {
            const selector = `#region-list [data-region-index="${index}"] input`;
            const input = document.querySelector(selector);
            if (!input) return;
            input.focus({ preventScroll: true });
            const length = input.value.length;
            if (typeof input.setSelectionRange === 'function') {
                input.setSelectionRange(length, length);
            }
        });
    }

    renderVertexEditor() {
        const container = document.querySelector('#vertex-editor-list');
        const badge = document.querySelector('#vertex-count-badge');
        if (!container) return;

        container.innerHTML = '';
        if (this.selectedRegionIndex === -1) {
            container.innerHTML = `<div class="p-4 text-center text-xs text-text-disabled">Select a region to edit vertices</div>`;
            if (badge) badge.textContent = '0 points';
            return;
        }

        const region = this.regions[this.selectedRegionIndex];
        if (badge) badge.textContent = `${region.points.length} points`;

        region.points.forEach((p, index) => {
            const item = document.createElement('div');
            item.className = "flex items-center justify-between px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors group";
            item.innerHTML = `
                <span class="text-text-disabled font-mono text-[10px]">${(index + 1).toString().padStart(2, '0')}</span>
                <span class="text-text-muted font-mono bg-surface-1 px-1.5 py-0.5 rounded border border-border-subtle shadow-sm">${Math.round(p[0])}, ${Math.round(p[1])}</span>
                <button class="text-text-disabled hover:text-error opacity-0 group-hover:opacity-100"><span class="material-symbols-outlined text-[14px]">close</span></button>
            `;

            item.querySelector('button').onclick = (e) => {
                e.stopPropagation();
                this.deleteVertex(this.selectedRegionIndex, index);
            };

            container.appendChild(item);
        });
    }

    selectRegion(index) {
        this.selectedRegionIndex = index;
        this.renderRegions();
        this.renderRegionList();
    }

    deleteRegion(index) {
        this.regions.splice(index, 1);
        if (this.selectedRegionIndex === index) this.selectedRegionIndex = -1;
        else if (this.selectedRegionIndex > index) this.selectedRegionIndex--;
        this.renderUI();
        this.markUnsaved();
    }

    deleteVertex(rIndex, vIndex) {
        if (this.regions[rIndex].points.length <= 3) {
            this.showToast("A region must have at least 3 points. Delete the region instead if needed.", 'warning');
            return;
        }
        this.regions[rIndex].points.splice(vIndex, 1);
        this.renderUI();
        this.markUnsaved();
    }

    startDraggingVertex(rIndex, vIndex) {
        let changed = false;
        const onMouseMove = (e) => {
            const img = document.querySelector('#main-image');
            const rect = img.getBoundingClientRect();

            let x = ((e.clientX - rect.left) / rect.width) * 100;
            let y = ((e.clientY - rect.top) / rect.height) * 100;

            // Constrain 0-100
            x = Math.max(0, Math.min(100, x));
            y = Math.max(0, Math.min(100, y));

            this.regions[rIndex].points[vIndex] = [x, y];
            changed = true;
            this.renderRegions();
            this.renderVertexEditor();
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (changed) {
                this.markUnsaved();
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }

    setupEventListeners() {
        // Back
        const backBtn = document.querySelector('header button');
        if (backBtn) backBtn.onclick = () => this.goBack();

        // Add region
        const addBtn = document.querySelector('#add-region-btn');
        if (addBtn) {
            addBtn.onclick = () => {
                // Default polygon
                this.regions.push({
                    label: 'New Region',
                    points: [[40, 40], [60, 40], [60, 60], [40, 60]]
                });
                this.selectedRegionIndex = this.regions.length - 1;
                this.renderUI();
                this.markUnsaved();
            };
        }

        // Publish (Save)
        const publishBtn = document.querySelector('button.bg-primary');
        if (publishBtn) {
            publishBtn.onclick = () => this.saveTask();
        }

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.addEventListener('input', () => this.markUnsaved());
        }

        const correctInput = document.querySelector('#required-correct-input');
        if (correctInput) {
            correctInput.addEventListener('input', () => this.markUnsaved());
        }

        window.addEventListener('resize', () => this.renderRegions());

        // Main Image Upload
        const changeImgBtn = document.querySelector('#change-image-btn');
        const mainFileInput = document.querySelector('#main-image-upload');
        if (changeImgBtn && mainFileInput) {
            changeImgBtn.onclick = () => mainFileInput.click();
            mainFileInput.onchange = (e) => this.handleMainImageUpload(e);
        }
    }

    async handleMainImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

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
                console.log("Main image uploaded:", data.path);
                this.task.task_data.content.image = data.path;
                this.renderUI();
                this.markUnsaved();
            } else {
                this.showToast(`Upload failed: ${data.error || 'upload_failed'}`, 'error');
            }
        } catch (error) {
            console.error("Error uploading image:", error);
            this.showToast("Error uploading image. See console.", 'error');
        } finally {
            event.target.value = '';
        }
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";

        const correctInput = document.querySelector('#required-correct-input');
        const requiredCorrect = correctInput ? parseInt(correctInput.value) : 1;

        // Validate prompt
        if (!prompt) {
            if (promptArea) promptArea.focus();
            return "Validation Error: Task prompt cannot be empty.";
        }

        // Validate main image
        if (!this.task.task_data.content.image) {
            return "Validation Error: Please upload a main image for the task.";
        }

        // Validate regions exist
        if (this.regions.length === 0) {
            return "Validation Error: At least one region is required.";
        }

        // Validate region labels
        for (let i = 0; i < this.regions.length; i++) {
            if (!this.regions[i].label || !this.regions[i].label.trim()) {
                this.selectRegion(i);
                return `Validation Error: Label for Region ${i + 1} is empty.`;
            }
        }

        // Validate required_correct
        if (isNaN(requiredCorrect) || requiredCorrect < 1) {
            if (correctInput) correctInput.focus();
            return "Validation Error: Required correct regions must be at least 1.";
        }

        if (requiredCorrect > this.regions.length) {
            if (correctInput) correctInput.focus();
            return `Validation Error: Required correct (${requiredCorrect}) cannot be greater than the total number of regions (${this.regions.length}).`;
        }

        return null; // Validation passed
    }

    calculateRegionArea(points = []) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < points.length; i += 1) {
            const [x1, y1] = points[i] || [0, 0];
            const [x2, y2] = points[(i + 1) % points.length] || [0, 0];
            area += (Number(x1) * Number(y2)) - (Number(x2) * Number(y1));
        }
        return Math.abs(area) / 2;
    }

    isPlaceholderRegionLabel(label) {
        const normalized = String(label || "").trim().toLowerCase();
        return normalized === "new region" || /^region\s+\d+$/i.test(normalized);
    }

    getSemanticWarnings() {
        const warnings = [];
        const labels = this.regions
            .map((region) => String(region?.label || "").trim())
            .filter(Boolean);

        const duplicateLabels = [];
        const seenLabels = new Set();

        labels.forEach((label) => {
            const key = label.toLowerCase();
            if (seenLabels.has(key)) {
                if (!duplicateLabels.includes(label)) {
                    duplicateLabels.push(label);
                }
                return;
            }
            seenLabels.add(key);
        });

        if (duplicateLabels.length) {
            warnings.push(`Повторяются названия областей: ${duplicateLabels.slice(0, 2).join(", ")}.`);
        }

        const placeholderCount = this.regions.filter((region) => this.isPlaceholderRegionLabel(region?.label)).length;
        if (placeholderCount > 0) {
            warnings.push(`У ${placeholderCount} областей осталось техническое имя. Лучше заменить его на понятную подсказку для пользователя.`);
        }

        const tinyRegions = this.regions.filter((region) => this.calculateRegionArea(region?.points) > 0 && this.calculateRegionArea(region?.points) < 25).length;
        if (tinyRegions > 0) {
            warnings.push(`${tinyRegions} областей выглядят слишком маленькими. Проверьте, что по ним реально удобно попадать.`);
        }

        return warnings;
    }

    /**
     * Build task data for saving to backend (BaseEditor abstract method)
     * @returns {Object} Task data object
     */
    buildTaskData() {
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";

        const correctInput = document.querySelector('#required-correct-input');
        const requiredCorrect = correctInput ? parseInt(correctInput.value) : 1;

        // Build content
        this.task.task_data.content.prompt = prompt;
        this.task.task_data.content.required_correct = requiredCorrect;
        this.task.task_data.content.regions = this.regions;

        return this.task.task_data;
    }

    /**
     * Called after task is successfully saved (BaseEditor hook)
     */
    onTaskSaved() {
        this.markSaved();
    }

    // ===== UNDO/REDO & AUTOSAVE SUPPORT =====

    /**
     * Capture current editor state for undo/redo and autosave
     * @returns {Object} State snapshot
     */
    captureState() {
        // Use buildTaskData to get the current state of the content
        const taskData = this.buildTaskData();
        return {
            content: JSON.parse(JSON.stringify(taskData.content)),
            taskSettings: this.captureTaskSettingsState(),
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
        if (Object.prototype.hasOwnProperty.call(state, 'taskSettings')) {
            this.restoreTaskSettingsState(state.taskSettings);
        }
        this.regions = this.task.task_data.content.regions || [];

        // Restore UI
        this.renderUI();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[DrawEditor] difficulty authoring refresh failed', error);
        });
        this.markUnsaved();
    }
}

if (!(typeof window !== 'undefined' && window.__DRAW_EDITOR_AUTO_INIT_DISABLED__)) {
    document.addEventListener('DOMContentLoaded', () => {
        window.editor = new DrawEditor();
    });
}
