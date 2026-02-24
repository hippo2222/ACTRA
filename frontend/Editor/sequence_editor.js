/**
 * ACTRA Sequence Assembly Editor
 */

class SequenceEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task, this.moduleId, this.topicId, this.taskId, this.hasUnsavedChanges
        // are now inherited from BaseEditor

        // Sequence Editor specific fields
        this.levels = [];
        this.init();
    }

    // Note: generateId() is now inherited from BaseEditor

    createEmptyLevel(title = "Новый уровень") {
        return {
            levelId: this.generateId("level"),
            title,
            items: [this.createEmptyItem()]
        };
    }

    createEmptyItem() {
        return {
            id: this.generateId("elem"),
            label: "Новый элемент"
        };
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
        if (!this.task) return 'Новое задание';
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
            'Новое задание'
        );
    }

    updateTaskTitleDisplay(name) {
        const display = document.querySelector('#task-title-display');
        if (!display) return;
        const fallback = this.getTaskDisplayName();
        const value = typeof name === 'string' ? name.trim() : '';
        display.textContent = value || fallback || 'Новое задание';
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

    showToast(message, variant = 'success', timeout = 4000) {
        if (typeof document === 'undefined') return;
        const toast = document.createElement('div');
        const palette = variant === 'error'
            ? { bg: 'bg-surface-2 border-l-4 border-error text-error-text', shadow: 'shadow-md' }
            : { bg: 'bg-success-lighter border-l-4 border-success text-success-text', shadow: 'shadow-md' };

        toast.className = `fixed top-6 right-6 z-50 text-sm font-semibold px-4 py-3 rounded-r-lg ${palette.bg} ${palette.shadow} backdrop-blur-md transition-all border-y border-r border-border-subtle flex items-center gap-3 animate-slide-in`;
        toast.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">${variant === 'error' ? 'report' : 'check_circle'}</span>
            <span>${message}</span>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-4px)';
            setTimeout(() => toast.remove(), 300);
        }, timeout);
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        this.moduleId = urlParams.get('module');
        this.topicId = urlParams.get('topic');
        this.taskId = urlParams.get('task');

        if (this.moduleId && this.topicId && this.taskId) {
            await this.loadTask(this.moduleId, this.topicId, this.taskId);
        } else {
            console.error("Не хватает параметров задания в URL");
            this.ensureDefaultStructure();
            this.renderUI();
        }

        this.setupEventListeners();
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
                        label: element.text || ""
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
                    label: item.label || ""
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
        div.className = 'bg-surface-2 rounded-xl p-2 border border-border-subtle shadow-sm group/level relative mb-6 transition-all hover:shadow-md';
        if (level.levelId) {
            div.style.viewTransitionName = `level-${level.levelId}`;
        }

        div.innerHTML = `
            <div class="flex items-center gap-3 p-3">
                <div class="w-8 h-8 rounded-lg bg-accent-lighter border border-accent-light flex items-center justify-center text-accent font-bold text-sm shrink-0">
                    ${lIndex + 1}
                </div>
                <input class="level-title-input bg-transparent border-transparent hover:border-border-subtle focus:border-primary focus:ring-0 rounded text-sm font-bold text-text-main px-2 py-1 flex-1 transition-colors" 
                       type="text" placeholder="Название уровня" value="${level.title || ""}"/>
                <div class="flex items-center gap-1 opacity-0 group-hover/level:opacity-100 transition-opacity">
                    <button class="p-1.5 hover:bg-surface-1 rounded text-text-muted hover:text-primary transition-colors move-up" title="Переместить вверх"><span class="material-symbols-outlined text-[20px]">arrow_upward</span></button>
                    <button class="p-1.5 hover:bg-surface-1 rounded text-text-muted hover:text-primary transition-colors move-down" title="Переместить вниз"><span class="material-symbols-outlined text-[20px]">arrow_downward</span></button>
                    <div class="w-px h-5 bg-border-subtle mx-1"></div>
                    <button class="p-1.5 hover:bg-surface-1 rounded text-text-muted hover:text-error transition-colors delete-level" title="Удалить уровень"><span class="material-symbols-outlined text-[20px]">close</span></button>
                </div>
            </div>
            <div class="flex gap-4 overflow-x-auto p-4 pt-1 custom-scrollbar min-h-[140px] items-container"></div>
        `;

        const titleInput = div.querySelector('.level-title-input');
        titleInput.oninput = (e) => {
            this.levels[lIndex].title = e.target.value;
            this.markUnsaved();
        };

        div.querySelector('.move-up').onclick = () => this.moveLevel(lIndex, -1);
        div.querySelector('.move-down').onclick = () => this.moveLevel(lIndex, 1);
        div.querySelector('.delete-level').onclick = () => this.deleteLevel(lIndex);

        const itemsContainer = div.querySelector('.items-container');
        level.items.forEach((item, iIndex) => {
            const block = this.createBlockElement(item, lIndex, iIndex);
            itemsContainer.appendChild(block);
        });

        const addButton = document.createElement('button');
        addButton.className = 'w-12 h-[104px] shrink-0 border-2 border-dashed border-border-subtle rounded-xl text-text-disabled flex items-center justify-center hover:border-primary-light hover:bg-primary-lighter hover:text-primary transition-all duration-300';
        addButton.setAttribute('aria-label', 'Добавить блок');
        addButton.innerHTML = '<span class="material-symbols-outlined text-[28px]">add</span>';
        addButton.onclick = () => this.addBlock(lIndex);
        itemsContainer.appendChild(addButton);

        return div;
    }

    createBlockElement(item, lIndex, iIndex) {
        const div = document.createElement('div');
        div.className = 'w-48 shrink-0 bg-surface-1 rounded-lg border border-border-subtle shadow-sm p-4 pt-6 flex flex-col gap-3 group/block relative hover:shadow-md hover:border-primary-light transition-all';
        if (item.id) {
            div.style.viewTransitionName = `block-${item.id}`;
        }

        div.innerHTML = `
            <button class="absolute top-2 right-2 p-1 hover:bg-bg-hover rounded-full text-text-muted hover:text-error transition-colors delete-block" title="Удалить элемент">
                <span class="material-symbols-outlined text-[16px]">close</span>
            </button>
            <textarea class="block-title-input w-full text-sm font-semibold border border-border-subtle bg-transparent focus:border-primary focus:ring-0 rounded-md text-text-main placeholder-text-disabled resize-none min-h-[44px] transition-colors py-2 px-3 text-center leading-tight overflow-hidden" 
                   rows="1" placeholder="Опишите элемент...">${item.label || ''}</textarea>
            <div class="flex justify-between pt-1 text-[11px] font-bold">
                <button class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-text-muted hover:text-primary hover:bg-primary-lighter transition-all move-left">
                    <span class="material-symbols-outlined text-[16px]">chevron_left</span>
                    Влево
                </button>
                <button class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-text-muted hover:text-primary hover:bg-primary-lighter transition-all move-right">
                    Вправо
                    <span class="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
            </div>
        `;

        const titleField = div.querySelector('.block-title-input');
        if (titleField) {
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
        div.querySelector('.move-left').onclick = () => this.moveBlock(lIndex, iIndex, -1);
        div.querySelector('.move-right').onclick = () => this.moveBlock(lIndex, iIndex, 1);

        return div;
    }

    moveLevel(index, direction) {
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < this.levels.length) {
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

    deleteLevel(index) {
        if (this.levels.length <= 1) {
            alert("Должен остаться минимум один уровень.");
            return;
        }
        if (confirm("Удалить весь уровень?")) {
            this.levels.splice(index, 1);
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory(); // Save state for undo/redo
        }
    }

    addLevel() {
        this.levels.push(this.createEmptyLevel());
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    addBlock(lIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        level.items.push(this.createEmptyItem());
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory();
    }

    deleteBlock(lIndex, iIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        if (level.items.length <= 1) {
            alert("В уровне должен быть хотя бы один шаг.");
            return;
        }
        level.items.splice(iIndex, 1);
        this.renderLevels();
        this.markUnsaved();
    }

    moveBlock(lIndex, iIndex, direction) {
        const level = this.levels[lIndex];
        if (!level) return;
        const newIndex = iIndex + direction;
        if (newIndex >= 0 && newIndex < level.items.length) {
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
        const backBtn = document.querySelector('#back-to-dashboard');
        if (backBtn) {
            backBtn.onclick = () => this.goBack();
        }

        const clearAllBtn = document.querySelector('#clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.onclick = () => {
                if (confirm("Очистить все уровни?")) {
                    this.levels = [this.createEmptyLevel()];
                    this.renderLevels();
                    this.markUnsaved();
                }
            };
        }

        const addLevelBtn = document.querySelector('#add-level-btn');
        if (addLevelBtn) {
            addLevelBtn.onclick = () => this.addLevel();
        }

        const saveBtn = document.querySelector('#save-task-btn');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveTask();
        }

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.addEventListener('input', () => this.markUnsaved());
        }

        const orderInside = document.querySelector('#order-inside-matters');
        if (orderInside) {
            orderInside.addEventListener('change', () => this.markUnsaved());
        }

        const levelOrder = document.querySelector('#level-order-matters');
        if (levelOrder) {
            levelOrder.addEventListener('change', () => this.markUnsaved());
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

                item.id = itemId;
                item.label = label;

                if (!elementMap.has(itemId)) {
                    elementMap.set(itemId, { id: itemId, text: label });
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
            return "Название задания не задано. Укажите его в карточке задания перед сохранением.";
        }

        // Validate prompt
        if (!prompt) {
            if (promptArea) promptArea.focus();
            return "Введите текст задания.";
        }

        // Validate levels exist
        if (!this.levels.length) {
            return "Add at least one level. Добавьте хотя бы один уровень.";
        }

        // Validate each level has items
        for (let i = 0; i < this.levels.length; i++) {
            const level = this.levels[i];
            if (!level.items || !level.items.length) {
                return `Levels cannot be empty. В уровне ${i + 1} должен быть минимум один шаг.`;
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
            return "Добавьте минимум два шага (элемента).";
        }

        return null; // Validation passed
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
        this.task.task_data.settings.level_order_matters = content.level_order_matters;
        this.task.task_data.settings.sequence_within_level_matters = content.sequence_within_level_matters;

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
        return {
            levels: JSON.parse(JSON.stringify(this.levels))
        };
    }

    /**
     * Restore editor state from snapshot
     * @param {Object} state - State to restore
     */
    restoreState(state) {
        this.levels = JSON.parse(JSON.stringify(state.levels));

        // Re-render UI
        if (this.task) {
            this.renderLevels();
        }

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

            // Settings Tooltip Logic
            const levelOrderCheckbox = document.getElementById('level-order-matters');
            const innerOrderCheckbox = document.getElementById('order-inside-matters');
            const helpText = document.getElementById('settings-help-text');

            if (levelOrderCheckbox && innerOrderCheckbox && helpText) {
                const updateHelp = () => {
                    const levelOrder = levelOrderCheckbox.checked;
                    const innerOrder = innerOrderCheckbox.checked;

                    let text = '';
                    if (levelOrder && innerOrder) {
                        text = '<strong>Строгая проверка:</strong><br>Требуется соблюдение заданной последовательности уровней и последовательности элементов в каждом уровне.';
                    } else if (levelOrder && !innerOrder) {
                        text = '<strong>Проверка уровней:</strong><br>Важна последовательность уровней. Порядок элементов в уровне не учитывается, важна только их принадлежность к уровню.';
                    } else if (!levelOrder && innerOrder) {
                        text = '<strong>Проверка элементов:</strong><br>Важна последовательность элементов в каждом уровне. Последовательность самих уровней не учитывается.';
                    } else {
                        text = '<strong>Только группировка:</strong><br>Важна только принадлежность элементов к соответствующим уровням. Последовательность не учитывается.';
                    }
                    helpText.innerHTML = text;
                };

                levelOrderCheckbox.addEventListener('change', updateHelp);
                innerOrderCheckbox.addEventListener('change', updateHelp);

                // Init
                updateHelp();
            }
        }
    });
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { SequenceEditor };
}
