/**
 * ACTRA Sequence Assembly Editor
 */

const SEQUENCE_ONBOARDING_TOUR_ID = 'sequence-editor-authoring';

class SequenceEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task, this.moduleId, this.topicId, this.taskId, this.hasUnsavedChanges
        // are now inherited from BaseEditor

        // Sequence Editor specific fields
        this.levels = [];
        this.sequenceOnboardingPreview = new URLSearchParams(window.location.search)
            .get('onboarding_preview') === SEQUENCE_ONBOARDING_TOUR_ID;
        this.sequenceOnboardingFinished = false;
        this.sequenceOnboardingDemoSnapshot = null;
        this.sequenceOnboardingDemoActive = false;
        this.init();
    }

    // Note: generateId() is now inherited from BaseEditor

    createEmptyLevel(title = wt('se.k001', 'Новый уровень')) {
        return {
            levelId: this.generateId("level"),
            title,
            items: [this.createEmptyItem()]
        };
    }

    createEmptyItem() {
        return {
            id: this.generateId("elem"),
            label: wt('se.k002', 'Новый элемент'),
            image: null,
            semanticKey: null
        };
    }

    normalizeSemanticText(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    buildItemSemanticKey(item) {
        const explicitKey = String(
            item?.semanticKey ||
            item?.semantic_key ||
            ''
        ).trim();
        if (explicitKey) {
            return explicitKey;
        }

        const normalizedLabel = this.normalizeSemanticText(item?.label || item?.text || '');
        if (normalizedLabel) {
            return `text:${normalizedLabel}`;
        }

        const normalizedImage = String(item?.image || '').trim().replace(/\\/g, '/');
        if (normalizedImage) {
            return `image:${normalizedImage}`;
        }

        const fallbackId = String(item?.id || '').trim();
        return fallbackId ? `id:${fallbackId}` : '';
    }

    ensureDefaultStructure() {
        if (!this.levels.length) {
            this.levels = [this.createEmptyLevel()];
        } else {
            this.levels.forEach(level => {
                if (!level.items.length) {
                    level.items.push(this.createEmptyItem());
                }
            });
        }
    }

    getTaskDisplayName() {
        if (!this.task) return wt('se.k003', 'Новое задание');
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
            wt('se.k003', 'Новое задание')
        );
    }

    updateTaskTitleDisplay(name) {
        const display = document.querySelector('#task-title-display');
        if (!display) return;
        const fallback = this.getTaskDisplayName();
        const value = typeof name === 'string' ? name.trim() : '';
        display.textContent = value || fallback || wt('se.k003', 'Новое задание');
    }

    markUnsaved() {
        super.markUnsaved();
    }

    autoResizeField(field) {
        if (!field) return;
        const minHeight = Number(field.dataset.minHeight || 40);
        field.style.height = 'auto';
        const target = Math.max(minHeight, field.scrollHeight);
        field.style.height = `${target}px`;
    }

    buildSettingsHelpHtml({
        orderInside = false,
        levelOrder = false,
    } = {}) {
        if (levelOrder && orderInside) {
            return wt('se.k004', '<strong>Строгая проверка:</strong><br>Требуется соблюдение заданной последовательности уровней и последовательности элементов в каждом уровне.');
        }
        if (levelOrder && !orderInside) {
            return wt('se.k005', '<strong>Проверка уровней:</strong><br>Важна последовательность уровней. Порядок элементов внутри уровня не учитывается, важна только их принадлежность к уровню.');
        }
        if (!levelOrder && orderInside) {
            return wt('se.k006', '<strong>Проверка элементов:</strong><br>Важна последовательность элементов в каждом уровне. Последовательность самих уровней не учитывается.');
        }
        return wt('se.k007', '<strong>Только группировка:</strong><br>Важна только принадлежность элементов к соответствующим уровням. Последовательность не учитывается.');
    }

    updateSettingsHelpText() {
        const helpText = document.querySelector('#settings-help-text');
        if (!helpText) return;
        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');
        helpText.innerHTML = this.buildSettingsHelpHtml({
            orderInside: Boolean(orderInside?.checked),
            levelOrder: Boolean(levelOrder?.checked),
        });
    }

    showToast(message, variant = 'success', timeout = 4000) {
        super.showToast(message, variant, timeout);
    }

    async confirmAction({
        title = wt('editor_base.modal.confirm_title', 'Подтверждение'),
        message = wt('editor_base.modal.confirm_message', 'Вы уверены?'),
        confirmText = wt('editor_base.modal.confirm_btn', 'Подтвердить'),
        cancelText = wt('editor_base.modal.cancel_btn', 'Отмена'),
        variant = 'error',
    } = {}) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.confirm === 'function') {
            return NotificationUI.confirm({ title, message, confirmText, cancelText, variant });
        }
        return window.confirm(message);
    }

    checkpointHistoryBeforeMutation() {
        if (!this.undoManager || typeof this.undoManager.getHistorySize !== 'function') return;
        if (this.undoManager.getHistorySize() > 0) return;
        this.undoManager.pushState(this.captureState());
        this.updateUndoRedoButtons();
    }

    async init() {
        let loaded = false;
        if (this.sequenceOnboardingPreview) {
            this.ensureSequenceOnboardingPreviewTask();
            this.applySequenceOnboardingPreviewState();
            loaded = true;
        } else {
            loaded = await this.initTaskFromUrlContext();
        }
        if (!loaded) {
            this.ensureDefaultStructure();
            this.renderUI();
        }
        this.setupSequenceOnboardingTourBridge();
        this.setupEventListeners();
    }

    ensureSequenceOnboardingPreviewTask() {
        if (!this.sequenceOnboardingPreview) return;

        this.moduleId = this.moduleId || 'onboarding-preview-module';
        this.topicId = this.topicId || 'onboarding-preview-topic';
        this.taskId = this.taskId || 'onboarding-preview-sequence';
        this.isNewTaskParam = true;
        this.hasPersistedTask = false;
        this.task = {
            task_data: {
                id: this.taskId,
                type: 'sequence_assembly',
                name: 'Последовательность: приготовление раствора',
                content: {},
                settings: {},
                meta: {
                    id: this.taskId,
                    module: this.moduleId,
                    topic: this.topicId,
                    name: 'Последовательность: приготовление раствора',
                },
            },
            metadata: {
                id: this.taskId,
                module: this.moduleId,
                topic: this.topicId,
                name: 'Последовательность: приготовление раствора',
                type: 'sequence_assembly',
            },
        };
    }

    createSequenceOnboardingContent() {
        return {
            prompt: 'Расположите этапы приготовления раствора по двум уровням: подготовка и выполнение.',
            sequence_within_level_matters: true,
            level_order_matters: true,
            elements: [
                { id: 'seq_elem_check_flask', text: 'Проверить мерную колбу', semantic_key: 'text:проверить мерную колбу' },
                { id: 'seq_elem_measure_solvent', text: 'Отмерить растворитель', semantic_key: 'text:отмерить растворитель' },
                { id: 'seq_elem_add_substance', text: 'Добавить вещество', semantic_key: 'text:добавить вещество' },
                { id: 'seq_elem_mix_solution', text: 'Перемешать раствор', semantic_key: 'text:перемешать раствор' },
            ],
            levels: [
                {
                    level_id: 'seq_level_prepare',
                    level_name: 'Подготовка',
                    blocks: ['seq_elem_check_flask', 'seq_elem_measure_solvent'],
                },
                {
                    level_id: 'seq_level_execute',
                    level_name: 'Выполнение',
                    blocks: ['seq_elem_add_substance', 'seq_elem_mix_solution'],
                },
            ],
        };
    }

    applySequenceOnboardingPreviewState() {
        if ((!this.sequenceOnboardingPreview && !this.sequenceOnboardingDemoActive) || !this.task) return;

        if (!this.task.task_data) this.task.task_data = {};
        if (!this.task.task_data.meta) this.task.task_data.meta = {};
        if (!this.task.metadata) this.task.metadata = {};
        this.task.task_data.name = 'Последовательность: приготовление раствора';
        this.task.task_data.type = 'sequence_assembly';
        this.task.task_data.meta.name = 'Последовательность: приготовление раствора';
        this.task.metadata.name = 'Последовательность: приготовление раствора';
        this.task.metadata.type = 'sequence_assembly';
        this.task.task_data.content = this.createSequenceOnboardingContent();
        this.task.task_data.settings = {
            ...(this.task.task_data.settings || {}),
            sequence_within_level_matters: true,
            level_order_matters: true,
        };
        this.levels = this.parseLevels(this.task.task_data.content);
        this.ensureDefaultStructure();
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    resetSequenceOnboardingPreviewState() {
        if (!this.sequenceOnboardingPreview || !this.task || this.sequenceOnboardingFinished) return;
        this.sequenceOnboardingFinished = true;
        if (!this.task.task_data) this.task.task_data = {};
        this.task.task_data.content = {
            prompt: '',
            sequence_within_level_matters: false,
            level_order_matters: false,
            elements: [],
            levels: [],
        };
        this.task.task_data.settings = {
            ...(this.task.task_data.settings || {}),
            sequence_within_level_matters: false,
            level_order_matters: false,
        };
        this.levels = [this.createEmptyLevel()];
        this.renderUI();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    cloneSequenceOnboardingValue(value) {
        if (value == null) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    applySequenceOnboardingDemoState() {
        if (this.sequenceOnboardingPreview || !this.task) return;
        if (!this.sequenceOnboardingDemoSnapshot) {
            this.sequenceOnboardingDemoSnapshot = {
                task: this.cloneSequenceOnboardingValue(this.task),
                levels: this.cloneSequenceOnboardingValue(this.levels),
                hasUnsavedChanges: this.hasUnsavedChanges,
            };
        }
        this.sequenceOnboardingDemoActive = true;
        this.applySequenceOnboardingPreviewState();
    }

    restoreSequenceOnboardingDemoState() {
        const snapshot = this.sequenceOnboardingDemoSnapshot;
        this.sequenceOnboardingDemoSnapshot = null;
        this.sequenceOnboardingDemoActive = false;
        if (!snapshot) return;
        this.task = this.cloneSequenceOnboardingValue(snapshot.task);
        this.levels = this.cloneSequenceOnboardingValue(snapshot.levels) || [];
        this.renderUI();
        this.hasUnsavedChanges = Boolean(snapshot.hasUnsavedChanges);
        this.updateSaveStatus();
    }

    setupSequenceOnboardingTourBridge() {
        window.addEventListener('onboarding:before-start', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== SEQUENCE_ONBOARDING_TOUR_ID || detail.preview) return;
            this.applySequenceOnboardingDemoState();
        });

        window.addEventListener('onboarding:finish', (event) => {
            const detail = event?.detail || {};
            if (detail.tourId !== SEQUENCE_ONBOARDING_TOUR_ID) return;
            if (!this.sequenceOnboardingPreview) {
                this.restoreSequenceOnboardingDemoState();
                return;
            }
            this.resetSequenceOnboardingPreviewState();
        });
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
     */
    onTaskLoaded() {
        const content = this.task.task_data.content || {};
        this.levels = this.parseLevels(content);
        this.ensureDefaultStructure();
        this.renderUI();
    }

    parseLevels(content) {
        const levels = [];
        const elements = Array.isArray(content.elements) ? content.elements : [];
        const elementsById = new Map(elements.map(el => [el.id, el]));

        if (Array.isArray(content.levels) && content.levels.length) {
            content.levels.forEach(level => {
                const items = (level.blocks || []).map(blockId => {
                    const element = elementsById.get(blockId) || {};
                    return {
                        id: blockId || this.generateId("elem"),
                        label: element.text || "",
                        image: element.image || null,
                        semanticKey: element.semantic_key || element.semanticKey || null
                    };
                });

                levels.push({
                    levelId: level.level_id || this.generateId("level"),
                    title: level.level_name || "",
                    items: items.length ? items : [this.createEmptyItem()]
                });
            });
        } else if (Array.isArray(content.sequence) && content.sequence.length) {
            content.sequence.forEach(level => {
                const items = (level.items || []).map(item => ({
                    id: item.id || this.generateId("elem"),
                    label: item.label || "",
                    image: item.image || null,
                    semanticKey: item.semantic_key || item.semanticKey || null
                }));

                levels.push({
                    levelId: level.level_id || this.generateId("level"),
                    title: level.title || "",
                    items: items.length ? items : [this.createEmptyItem()]
                });
            });
        }

        return levels;
    }

    renderUI() {
        if (!this.task) {
            this.task = {
                task_data: {
                    name: "",
                    content: {},
                    meta: {
                        module: this.moduleId,
                        topic: this.topicId
                    }
                },
                metadata: { id: this.taskId || "" }
            };
        }

        this.updateTaskTitleDisplay();

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.value = (this.task.task_data.content && this.task.task_data.content.prompt) || "";
        }

        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');
        const content = this.task.task_data.content || {};

        if (orderInside) {
            const sequenceMatters = content.sequence_within_level_matters;
            orderInside.checked = sequenceMatters !== false;
        }
        if (levelOrder) {
            const levelOrderMatters = content.level_order_matters;
            levelOrder.checked = levelOrderMatters !== false;
        }

        this.renderLevels();
        this.updateSettingsHelpText();
        this.markSaved();
    }

    renderLevels() {
        const container = document.querySelector('#levels-container');
        if (!container) return;

        this.ensureDefaultStructure();
        container.innerHTML = '';

        this.levels.forEach((level, lIndex) => {
            const levelEl = this.createLevelElement(level, lIndex);
            container.appendChild(levelEl);
        });
    }

    createLevelElement(level, lIndex) {
        const div = document.createElement('div');
        div.className = 'card-elevated rounded-xl p-2 group/level relative mb-6 transition-all';
        div.setAttribute('data-onboarding-spotlight', 'frame');
        div.setAttribute('data-onboarding-target', lIndex === 0 ? 'sequence-first-level' : `sequence-level-${lIndex + 1}`);
        if (level.levelId) {
            div.style.viewTransitionName = `level-${level.levelId}`;
        }

        div.innerHTML = `
            <div class="flex items-center gap-3 p-3">
                <div class="sequence-level-index w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0">
                    ${lIndex + 1}
                </div>
                <input class="level-title-input bg-transparent border-transparent hover:border-border-subtle focus:border-primary focus:ring-0 rounded text-sm font-bold text-text-main px-2 py-1 flex-1 transition-colors" 
                       type="text" placeholder="${wt('se.k008', 'Название уровня')}"/>
                <span class="sequence-level-title-onboarding-anchor absolute pointer-events-none" aria-hidden="true"></span>
                <span class="sequence-level-title-onboarding-edge absolute pointer-events-none" aria-hidden="true"></span>
                <div class="sequence-level-actions flex items-center gap-1 transition-opacity">
                    <button class="move-up icon-button-muted" title="${wt('se.k009', 'Переместить вверх')}"><span class="material-symbols-outlined text-[20px]">arrow_upward</span></button>
                    <button class="move-down icon-button-muted" title="${wt('se.k010', 'Переместить вниз')}"><span class="material-symbols-outlined text-[20px]">arrow_downward</span></button>
                    <div class="w-px h-5 bg-border-subtle mx-1"></div>
                    <button class="delete-level icon-button-muted border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error" title="${wt('se.k011', 'Удалить уровень')}"><span class="material-symbols-outlined text-[20px]">close</span></button>
                </div>
            </div>
            <div class="flex gap-4 overflow-x-auto p-4 pt-1 custom-scrollbar min-h-[140px] items-container"></div>
        `;

        const titleInput = div.querySelector('.level-title-input');
        titleInput.value = level.title || '';
        if (lIndex === 0) {
            const titleAnchor = div.querySelector('.sequence-level-title-onboarding-anchor');
            if (titleAnchor) {
                const titleWidth = Math.max(104, Math.min(220, (level.title || '').length * 8 + 28));
                titleAnchor.setAttribute('data-onboarding-target', 'sequence-first-level-title');
                titleAnchor.setAttribute('data-onboarding-clone-variant', 'sequence-level-title');
                titleAnchor.textContent = level.title || wt('se.k008', 'Название уровня');
                titleAnchor.style.left = '72px';
                titleAnchor.style.top = '18px';
                titleAnchor.style.width = `${titleWidth}px`;
                titleAnchor.style.height = '30px';

                const titleEdge = div.querySelector('.sequence-level-title-onboarding-edge');
                if (titleEdge) {
                    titleEdge.setAttribute('data-onboarding-target', 'sequence-first-level-title-edge');
                    titleEdge.style.left = `${72 + titleWidth - 6}px`;
                    titleEdge.style.top = '18px';
                    titleEdge.style.width = '6px';
                    titleEdge.style.height = '30px';
                }

            }
        }
        titleInput.oninput = (e) => {
            this.levels[lIndex].title = e.target.value;
            this.markUnsaved();
        };

        const levelActions = div.querySelector('.sequence-level-actions');
        if (levelActions && lIndex === 0) {
            levelActions.setAttribute('data-onboarding-target', 'sequence-first-level-actions');
        }

        div.querySelector('.move-up').onclick = () => this.moveLevel(lIndex, -1);
        div.querySelector('.move-down').onclick = () => this.moveLevel(lIndex, 1);
        div.querySelector('.delete-level').onclick = () => this.deleteLevel(lIndex);

        const itemsContainer = div.querySelector('.items-container');
        if (lIndex === 0) {
            itemsContainer.setAttribute('data-onboarding-target', 'sequence-first-level-items');
        }
        level.items.forEach((item, iIndex) => {
            const block = this.createBlockElement(item, lIndex, iIndex);
            itemsContainer.appendChild(block);
        });

        const addButton = document.createElement('button');
        addButton.className = 'sequence-add-block-btn empty-state-card empty-state-card--compact empty-state-card--icon-only w-12 h-[104px] shrink-0 border-2 border-dashed text-text-disabled hover:text-primary transition-all duration-300';
        addButton.title = wt('se.k012', 'Добавить шаг в этот уровень');
        addButton.setAttribute('aria-label', wt('se.k013', 'Добавить блок'));
        if (lIndex === 0) {
            addButton.setAttribute('data-onboarding-target', 'sequence-first-level-add-step');
        }
        addButton.innerHTML = '<span class="material-symbols-outlined text-[28px]">add</span>';
        addButton.onclick = () => this.addBlock(lIndex);
        itemsContainer.appendChild(addButton);

        return div;
    }

    createBlockElement(item, lIndex, iIndex) {
        const div = document.createElement('div');
        div.className = 'sequence-block-card card-elevated w-48 shrink-0 rounded-lg p-4 pt-8 flex flex-col gap-3 group/block relative transition-all';
        if (lIndex === 0 && iIndex === 0) {
            div.setAttribute('data-onboarding-target', 'sequence-first-step');
        } else if (lIndex === 0 && iIndex === 1) {
            div.setAttribute('data-onboarding-target', 'sequence-second-step');
        }
        if (item.id) {
            div.style.viewTransitionName = `block-${item.id}`;
        }

        div.innerHTML = `
            <button class="delete-block sequence-block-delete icon-button-muted icon-button-muted--xs absolute top-2 right-2 border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error" title="${wt('se.k014', 'Удалить элемент')}">
                <span class="material-symbols-outlined text-[16px]">close</span>
            </button>
            <textarea class="block-title-input sequence-block-title w-full text-sm font-semibold border border-border-subtle bg-transparent focus:border-primary focus:ring-0 rounded-md text-text-main placeholder-text-disabled resize-none min-h-[44px] transition-colors py-2 px-3 text-center leading-tight overflow-hidden" 
                   rows="1" placeholder="${wt('se.k015', 'Опишите элемент...')}"></textarea>
            <div class="sequence-block-actions grid grid-cols-2 gap-2 pt-1 text-[11px] font-bold">
                <button class="move-left sequence-block-move-btn btn-secondary btn-secondary--compact inline-flex items-center justify-center gap-1 w-full min-w-0 rounded-md transition-all">
                    <span class="material-symbols-outlined text-[16px]">chevron_left</span>
                    ${wt('se.k016', 'Влево')}
                </button>
                <button class="move-right sequence-block-move-btn btn-secondary btn-secondary--compact inline-flex items-center justify-center gap-1 w-full min-w-0 rounded-md transition-all">
                    ${wt('se.k017', 'Вправо')}
                    <span class="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
            </div>
        `;

        const titleField = div.querySelector('.block-title-input');
        if (titleField) {
            if (lIndex === 0 && iIndex === 0) {
                titleField.setAttribute('data-onboarding-target', 'sequence-first-step-text');
            }
            titleField.value = item.label || '';
            titleField.dataset.minHeight = titleField.scrollHeight || titleField.clientHeight || 40;
            titleField.style.overflow = 'hidden';
            this.autoResizeField(titleField);
            titleField.oninput = (e) => {
                this.levels[lIndex].items[iIndex].label = e.target.value;
                this.autoResizeField(e.target);
                this.markUnsaved();
            };
        }

        div.querySelector('.delete-block').onclick = () => this.deleteBlock(lIndex, iIndex);
        const moveLeft = div.querySelector('.move-left');
        const moveRight = div.querySelector('.move-right');
        if (lIndex === 0 && iIndex === 0) {
            div.querySelector('.sequence-block-actions')?.setAttribute('data-onboarding-target', 'sequence-first-step-actions');
            moveLeft.setAttribute('data-onboarding-target', 'sequence-first-step-move-left');
            moveRight.setAttribute('data-onboarding-target', 'sequence-first-step-move-right');
        }
        moveLeft.onclick = () => this.moveBlock(lIndex, iIndex, -1);
        moveRight.onclick = () => this.moveBlock(lIndex, iIndex, 1);

        return div;
    }

    moveLevel(index, direction) {
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < this.levels.length) {
            this.checkpointHistoryBeforeMutation();
            const [level] = this.levels.splice(index, 1);
            this.levels.splice(newIndex, 0, level);

            if (document.startViewTransition) {
                document.startViewTransition(() => {
                    this.renderLevels();
                    this.markUnsaved();
                });
            } else {
                this.renderLevels();
                this.markUnsaved();
            }
        }
    }

    async deleteLevel(index) {
        if (this.levels.length <= 1) {
            this.showToast(wt('se.k018', 'Должен остаться минимум один уровень.'), 'error');
            return;
        }
        const confirmed = await this.confirmAction({
            title: wt('se.k019', 'Удалить уровень?'),
            message: wt('se.k020', 'Будет удалён весь уровень вместе со всеми шагами.'),
            confirmText: wt('se.k021', 'Удалить'),
            cancelText: wt('editor_base.modal.cancel_btn', 'Отмена'),
            variant: 'error',
        });
        if (!confirmed) return;
        this.checkpointHistoryBeforeMutation();
        this.levels.splice(index, 1);
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory(); // Save state for undo/redo
        this.showToast(wt('se.k022', 'Уровень удалён. При необходимости нажмите Ctrl+Z, чтобы вернуть его.'), 'info');
    }

    addLevel() {
        this.checkpointHistoryBeforeMutation();
        this.levels.push(this.createEmptyLevel());
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    addBlock(lIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        this.checkpointHistoryBeforeMutation();
        level.items.push(this.createEmptyItem());
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory();
    }

    deleteBlock(lIndex, iIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        if (level.items.length <= 1) {
            this.showToast(wt('se.k023', 'В уровне должен быть хотя бы один шаг.'), 'error');
            return;
        }
        this.checkpointHistoryBeforeMutation();
        level.items.splice(iIndex, 1);
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory();
        this.showToast(wt('se.k024', 'Шаг удалён. При необходимости нажмите Ctrl+Z, чтобы вернуть его.'), 'info');
    }

    moveBlock(lIndex, iIndex, direction) {
        const level = this.levels[lIndex];
        if (!level) return;
        const newIndex = iIndex + direction;
        if (newIndex >= 0 && newIndex < level.items.length) {
            this.checkpointHistoryBeforeMutation();
            const [item] = level.items.splice(iIndex, 1);
            level.items.splice(newIndex, 0, item);

            if (document.startViewTransition) {
                document.startViewTransition(() => {
                    this.renderLevels();
                    this.markUnsaved();
                    this.saveStateToHistory();
                });
            } else {
                this.renderLevels();
                this.markUnsaved();
                this.saveStateToHistory();
            }
        }
    }

    setupEventListeners() {
        const titleDisplay = document.querySelector('#task-title-display');
        if (titleDisplay) {
            this.setupHeaderRenameTrigger(titleDisplay, {
                onSuccess: () => this.updateTaskTitleDisplay()
            });
        }

        const backBtn = document.querySelector('#back-to-dashboard');
        if (backBtn) {
            backBtn.title = wt('se.k025', 'Вернуться к редактору заданий');
            backBtn.setAttribute('aria-label', backBtn.title);
            backBtn.onclick = () => this.goBack();
        }

        const clearAllBtn = document.querySelector('#clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.title = wt('se.k026', 'Очистить всю текущую структуру');
            clearAllBtn.onclick = async () => {
                const confirmed = await this.confirmAction({
                    title: wt('se.k027', 'Очистить все уровни?'),
                    message: wt('se.k028', 'Редактор оставит только один новый пустой уровень.'),
                    confirmText: wt('se.k029', 'Очистить'),
                    cancelText: wt('editor_base.modal.cancel_btn', 'Отмена'),
                    variant: 'error',
                });
                if (confirmed) {
                    this.checkpointHistoryBeforeMutation();
                    this.levels = [this.createEmptyLevel()];
                    this.renderLevels();
                    this.markUnsaved();
                    this.saveStateToHistory();
                    this.showToast(wt('se.k030', 'Редактор очищен. При необходимости нажмите Ctrl+Z, чтобы вернуть предыдущую структуру.'), 'info', 5200);
                }
            };
        }

        const addLevelBtn = document.querySelector('#add-level-btn');
        if (addLevelBtn) {
            addLevelBtn.title = wt('se.k031', 'Добавить новый уровень');
            addLevelBtn.onclick = () => this.addLevel();
        }

        const saveBtn = document.querySelector('#save-task-btn');
        if (saveBtn) {
            saveBtn.title = wt('se.k032', 'Сохранить задание');
            saveBtn.onclick = () => this.saveTask();
        }

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.addEventListener('input', () => this.markUnsaved());
        }

        const orderInside = document.querySelector('#order-inside-matters');
        if (orderInside) {
            orderInside.addEventListener('change', () => {
                this.updateSettingsHelpText();
                this.markUnsaved();
            });
        }

        const levelOrder = document.querySelector('#level-order-matters');
        if (levelOrder) {
            levelOrder.addEventListener('change', () => {
                this.updateSettingsHelpText();
                this.markUnsaved();
            });
        }

    }

    buildStructure() {
        const elementMap = new Map();

        const normalizedLevels = this.levels.map(level => {
            const levelId = level.levelId || this.generateId("level");
            level.levelId = levelId;

            const blocks = [];
            level.items.forEach(item => {
                const itemId = item.id || this.generateId("elem");
                const label = (item.label || "").trim();
                const semanticKey = this.buildItemSemanticKey(item);

                item.id = itemId;
                item.label = label;
                item.semanticKey = semanticKey || null;

                if (!elementMap.has(itemId)) {
                    const entry = { id: itemId, text: label };
                    if (semanticKey) entry.semantic_key = semanticKey;
                    if (item.image) entry.image = item.image;
                    elementMap.set(itemId, entry);
                }

                blocks.push(itemId);
            });

            const normalizedLevel = { level_id: levelId, blocks };
            const levelName = (level.title || "").trim();
            level.title = levelName;
            if (levelName) {
                normalizedLevel.level_name = levelName;
            }
            return normalizedLevel;
        });

        const legacySequence = this.levels.map(level => ({
            level_id: level.levelId,
            title: level.title || "",
            items: level.items.map(item => ({
                id: item.id,
                label: item.label || ""
            }))
        }));

        return {
            elements: Array.from(elementMap.values()),
            levels: normalizedLevels,
            legacySequence
        };
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        const humanName = this.getTaskDisplayName().trim();
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";

        // Validate task name
        if (!humanName) {
            return wt('se.k033', 'Название задания не задано. Укажите его в карточке задания перед сохранением.');
        }

        // Validate prompt
        if (!prompt) {
            if (promptArea) promptArea.focus();
            return wt('se.k034', 'Введите текст задания.');
        }

        // Validate levels exist
        if (!this.levels.length) {
            return wt('se.k035', 'Добавьте хотя бы один уровень.');
        }

        // Validate each level has items
        for (let i = 0; i < this.levels.length; i++) {
            const level = this.levels[i];
            if (!level.items || !level.items.length) {
                return `В уровне ${i + 1} должен быть минимум один шаг.`;
            }

            // Validate each item has label
            for (let j = 0; j < level.items.length; j++) {
                const label = (level.items[j].label || "").trim();
                if (!label) {
                    const levelLabel = level.title ? `«${level.title}»` : `#${i + 1}`;
                    return `Заполните описание шага ${j + 1} в уровне ${levelLabel}.`;
                }
            }
        }

        // Validate minimum elements
        const { elements } = this.buildStructure();
        if (elements.length < 2) {
            return wt('se.k036', 'Добавьте минимум два шага (элемента).');
        }

        return null; // Validation passed
    }

    getSemanticWarnings() {
        const warnings = [];
        const levels = Array.isArray(this.levels) ? this.levels : [];
        const singleStepLevels = levels.filter((level) => Array.isArray(level?.items) && level.items.length === 1);
        const orderInsideMatters = Boolean(
            document.querySelector('#order-inside-matters')?.checked
            ?? this.task?.task_data?.content?.sequence_within_level_matters
        );

        if (singleStepLevels.length > 0) {
            warnings.push(`У ${singleStepLevels.length} уровней только по одному шагу. Проверьте, действительно ли здесь нужна многоуровневая структура.`);
        }

        if (levels.length > 1 && levels.every((level) => Array.isArray(level?.items) && level.items.length === 1)) {
            warnings.push(wt('se.k037', 'Каждый уровень содержит только один шаг. Такая структура может ощущаться слишком плоской для задания на последовательность.'));
        }

        const duplicates = [];
        const seen = new Set();
        const semanticSignatures = new Map();

        levels.forEach((level, index) => {
            const items = Array.isArray(level?.items) ? level.items : [];
            const semanticKeys = [];

            items.forEach((item) => {
                const label = String(item?.label || "").trim();
                if (label) {
                    const key = label.toLowerCase();
                    if (seen.has(key)) {
                        if (!duplicates.includes(label)) {
                            duplicates.push(label);
                        }
                    } else {
                        seen.add(key);
                    }
                }

                const semanticKey = this.buildItemSemanticKey(item);
                if (semanticKey) {
                    semanticKeys.push(semanticKey);
                }
            });

            if (!semanticKeys.length) {
                return;
            }

            const signatureParts = orderInsideMatters ? semanticKeys : [...semanticKeys].sort();
            const signature = signatureParts.join(' | ');
            if (!semanticSignatures.has(signature)) {
                semanticSignatures.set(signature, []);
            }
            semanticSignatures.get(signature).push(index + 1);
        });

        if (duplicates.length) {
            warnings.push(
                `Есть одинаковые названия шагов: ${duplicates.slice(0, 2).join(", ")}. ` +
                `При проверке такие шаги считаются взаимозаменяемыми. Если это разные по смыслу шаги, уточните их текст.`
            );
        }

        const ambiguousLevelGroups = Array.from(semanticSignatures.values())
            .filter((indexes) => indexes.length > 1)
            .map((indexes) => indexes.join(', '));

        if (ambiguousLevelGroups.length) {
            warnings.push(
                `Уровни ${ambiguousLevelGroups[0]} семантически не различаются по составу шагов. ` +
                `На сложностях с вводом названий тренажер не сможет надежно различить такие уровни без разных шагов или разных формулировок.`
            );
        }

        return warnings;
    }

    /**
     * Build task data for saving to backend (BaseEditor abstract method)
     * @returns {Object} Task data object
     */
    buildTaskData() {
        const humanName = this.getTaskDisplayName().trim();
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";
        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');

        const content = this.task.task_data.content || {};

        // Set task name and prompt
        this.task.task_data.name = this.task.task_data.name || humanName;
        content.prompt = prompt;

        // Set sequence options
        if (orderInside) {
            content.sequence_within_level_matters = orderInside.checked;
        } else if (typeof content.sequence_within_level_matters !== "boolean") {
            content.sequence_within_level_matters = false;
        }

        if (levelOrder) {
            content.level_order_matters = levelOrder.checked;
        } else if (typeof content.level_order_matters !== "boolean") {
            content.level_order_matters = false;
        }

        // Build structure
        const { elements, levels, legacySequence } = this.buildStructure();
        content.elements = elements;
        content.levels = levels;
        content.sequence = legacySequence;

        // Clean stale fields that don't belong to sequence_assembly
        delete content.annotations;
        delete content.task_name;

        this.task.task_data.content = content;

        // Sync settings with content flags to avoid inconsistency
        if (!this.task.task_data.settings) {
            this.task.task_data.settings = {};
        }
        const s = this.task.task_data.settings;
        s.level_order_matters = content.level_order_matters;
        s.sequence_within_level_matters = content.sequence_within_level_matters;
        // Preserve or set defaults for extended settings
        if (typeof s.shuffle_elements !== 'boolean') s.shuffle_elements = true;
        if (typeof s.show_hints !== 'boolean') s.show_hints = false;
        if (typeof s.allow_duplicates !== 'boolean') s.allow_duplicates = false;

        return this.task.task_data;
    }

    /**
     * Called after task is successfully saved (BaseEditor hook)
     */
    onTaskSaved() {
        this.markSaved();
    }

    // ===== UNDO/REDO SUPPORT =====

    /**
     * Capture current editor state for undo/redo
     * @returns {Object} State snapshot
     */
    captureState() {
        const promptArea = document.querySelector('#prompt-textarea');
        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');
        return {
            levels: JSON.parse(JSON.stringify(this.levels)),
            prompt: promptArea ? promptArea.value : '',
            sequence_within_level_matters: Boolean(orderInside?.checked),
            level_order_matters: Boolean(levelOrder?.checked),
            taskSettings: this.captureTaskSettingsState(),
        };
    }

    /**
     * Restore editor state from snapshot
     * @param {Object} state - State to restore
     */
    restoreState(state) {
        this.levels = JSON.parse(JSON.stringify(state.levels));
        const content = this.task?.task_data?.content;
        const prompt = typeof state.prompt === 'string' ? state.prompt : '';
        const sequenceWithinLevelMatters = Boolean(state.sequence_within_level_matters);
        const levelOrderMatters = Boolean(state.level_order_matters);

        if (content && typeof content === 'object') {
            content.prompt = prompt;
            content.sequence_within_level_matters = sequenceWithinLevelMatters;
            content.level_order_matters = levelOrderMatters;
        }
        if (Object.prototype.hasOwnProperty.call(state, 'taskSettings')) {
            this.restoreTaskSettingsState(state.taskSettings);
        }

        // Re-render UI
        if (this.task) {
            this.renderLevels();
        }

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.value = prompt;
        }

        const orderInside = document.querySelector('#order-inside-matters');
        if (orderInside) {
            orderInside.checked = sequenceWithinLevelMatters;
        }

        const levelOrder = document.querySelector('#level-order-matters');
        if (levelOrder) {
            levelOrder.checked = levelOrderMatters;
        }

        this.updateSettingsHelpText();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[SequenceEditor] difficulty authoring refresh failed', error);
        });

        this.markUnsaved();
    }
}

if (typeof window !== 'undefined') {
    window.SequenceEditor = SequenceEditor;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof window !== 'undefined' && !window.__SEQUENCE_EDITOR_AUTO_INIT_DISABLED__) {
            window.editor = new SequenceEditor();
        }
    });
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { SequenceEditor };
}
