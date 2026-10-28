/**
 * ACTRA Sequence Assembly Editor
 */

function wt(key, fallback) {
    if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
        const v = window.i18n.t(key);
        return v !== key ? v : fallback;
    }
    return fallback;
}

const SEQUENCE_ONBOARDING_TOUR_ID = 'sequence-editor-authoring';
const SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID = 'sequence-hierarchy-editor-authoring';

class SequenceEditor extends BaseEditor {
    constructor() {
        super(); // Call BaseEditor constructor

        // Note: this.task, this.moduleId, this.topicId, this.taskId, this.hasUnsavedChanges
        // are now inherited from BaseEditor

        // Sequence Editor specific fields
        this.levels = [];
        this.nodes = [];
        const initUrlParams = (typeof window !== 'undefined' && window.location?.search)
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        const initModeParam = String(initUrlParams.get('initial_mode') || initUrlParams.get('subtype') || '').trim().toLowerCase();
        this.displayMode = (initModeParam === 'hierarchy') ? 'hierarchy' : 'linear';
        this.colorDifferentiation = true;
        this.canvasZoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.isSpacePressed = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panOriginX = 0;
        this.panOriginY = 0;
        this.panMouseButton = null;
        this.minimapVisible = false;
        const urlParams = new URLSearchParams(window.location.search);
        const previewTourParam = urlParams.get('onboarding_preview') || urlParams.get('onboarding_tour') || '';
        this.onboardingPreviewTourId = previewTourParam;
        this.sequenceOnboardingPreview = previewTourParam === SEQUENCE_ONBOARDING_TOUR_ID
            || previewTourParam === SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID;
        this.sequenceOnboardingFinished = false;
        this.sequenceOnboardingDemoSnapshot = null;
        this.sequenceOnboardingDemoActive = false;
        this.activeOnboardingTourId = null;
        this.init();
    }

    // Note: generateId() is now inherited from BaseEditor

    createEmptyLevel(title = '') {
        return {
            levelId: this.generateId("level"),
            title,
            items: [this.createEmptyItem()]
        };
    }

    createEmptyItem(label = '') {
        return {
            id: this.generateId("elem"),
            label: String(label || ''),
            image: null,
            semanticKey: null
        };
    }

    createEmptyNode({ levelId, parentId = null, items = null, columnTitle = '' } = {}) {
        return {
            nodeId: this.generateId("node"),
            levelId: levelId || (this.levels[0] && this.levels[0].levelId) || this.generateId("level"),
            parentId: parentId || null,
            items: Array.isArray(items) && items.length ? items : [this.createEmptyItem()],
            columnTitle: String(columnTitle || '')
        };
    }

    toRoman(num) {
        const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
        return roman[num - 1] || String(num);
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
        if (this.displayMode === 'hierarchy') {
            if (!this.nodes.length) {
                this.syncNodesFromLevels();
            } else {
                this.syncLevelsFromNodes();
            }
        }
    }

    syncNodesFromLevels() {
        if (!this.levels.length) {
            this.levels = [this.createEmptyLevel()];
        }
        const isBlankSingle = this.levels.length === 1 &&
            !this.levels[0].title &&
            this.levels[0].items.length === 1 &&
            !String(this.levels[0].items[0]?.label || '').trim();

        if (isBlankSingle) {
            // Build a 2-column × 2-tier starter classification skeleton
            const tier1 = this.levels[0];
            const tier2 = this.createEmptyLevel('');
            this.levels = [tier1, tier2];
            const root1 = this.createEmptyNode({ levelId: tier1.levelId, parentId: null, items: [tier1.items[0]] });
            const root2 = this.createEmptyNode({ levelId: tier1.levelId, parentId: null, items: [this.createEmptyItem()] });
            const child1 = this.createEmptyNode({ levelId: tier2.levelId, parentId: root1.nodeId, items: [tier2.items[0]] });
            const child2 = this.createEmptyNode({ levelId: tier2.levelId, parentId: root2.nodeId, items: [this.createEmptyItem()] });
            this.nodes = [root1, root2, child1, child2];
            this.syncLevelsFromNodes();
            return;
        }

        const builtNodes = [];
        let prevTierNodes = [];
        this.levels.forEach((level, lIndex) => {
            const levelItems = Array.isArray(level.items) && level.items.length
                ? level.items
                : [this.createEmptyItem()];
            const currentTierNodes = [];
            if (lIndex === 0) {
                levelItems.forEach((item) => {
                    const n = this.createEmptyNode({
                        levelId: level.levelId,
                        parentId: null,
                        items: [{ ...item }]
                    });
                    builtNodes.push(n);
                    currentTierNodes.push(n);
                });
            } else {
                if (prevTierNodes.length > 0 && levelItems.length === prevTierNodes.length) {
                    levelItems.forEach((item, idx) => {
                        const n = this.createEmptyNode({
                            levelId: level.levelId,
                            parentId: prevTierNodes[idx].nodeId,
                            items: [{ ...item }]
                        });
                        builtNodes.push(n);
                        currentTierNodes.push(n);
                    });
                } else {
                    const parentNode = prevTierNodes[0] || null;
                    levelItems.forEach((item) => {
                        const n = this.createEmptyNode({
                            levelId: level.levelId,
                            parentId: parentNode ? parentNode.nodeId : null,
                            items: [{ ...item }]
                        });
                        builtNodes.push(n);
                        currentTierNodes.push(n);
                    });
                }
            }
            prevTierNodes = currentTierNodes;
        });
        this.nodes = builtNodes;
        this.syncLevelsFromNodes();
    }

    syncLevelsFromNodes() {
        if (!Array.isArray(this.nodes) || !this.nodes.length) return;
        const nodesByLevel = new Map();
        this.nodes.forEach((node) => {
            if (!node || !node.levelId) return;
            if (!nodesByLevel.has(node.levelId)) {
                nodesByLevel.set(node.levelId, []);
            }
            nodesByLevel.get(node.levelId).push(node);
        });

        this.levels.forEach((level) => {
            const tierNodes = nodesByLevel.get(level.levelId) || [];
            const flatItems = [];
            tierNodes.forEach((node) => {
                if (!Array.isArray(node.items) || !node.items.length) {
                    node.items = [this.createEmptyItem()];
                }
                node.items.forEach((item) => {
                    if (!item.id) item.id = this.generateId("elem");
                    flatItems.push(item);
                });
            });
            level.items = flatItems.length ? flatItems : [this.createEmptyItem()];
        });
    }

    getTaskDisplayName() {
        if (!this.task) return wt('se.k003', 'Новое задание');
        const taskData = this.task.task_data || {};
        const meta = taskData.meta || {};
        const metadata = this.task.metadata || {};
        const candidate = (
            taskData.name ||
            taskData.title ||
            meta.title ||
            meta.name ||
            metadata.title ||
            metadata.name ||
            ''
        );
        if (candidate && !/^task_[a-f0-9]{8,}$/i.test(String(candidate).trim())) {
            return String(candidate).trim();
        }
        return wt('se.k003', 'Новое задание');
    }

    updateTaskTitleDisplay(name) {
        const display = document.querySelector('#task-title-display');
        if (!display) return;
        display.removeAttribute('data-i18n');
        const fallback = this.getTaskDisplayName();
        const value = typeof name === 'string' && !/^task_[a-f0-9]{8,}$/i.test(name.trim()) ? name.trim() : '';
        const titleText = value || fallback || wt('se.k003', 'Новое задание');
        display.textContent = titleText;
        display.title = titleText;
    }

    adjustPromptHeight(el) {
        if (!el) return;
        el.style.height = 'auto';
        const minH = el.classList.contains('se-hierarchy-prompt') ? 52 : 44;
        const scrollH = el.scrollHeight || 0;
        const nextH = Math.max(scrollH, minH);
        el.style.height = `${Math.min(nextH, 120)}px`;
    }

    syncPromptAccordion(collapsed) {
        const accordion = document.querySelector('#se-prompt-accordion');
        if (!accordion) return;
        const promptArea = document.querySelector('#prompt-textarea');
        const preview = document.querySelector('#se-prompt-preview');
        const toggleIcon = document.querySelector('#se-prompt-toggle-icon');
        const toggleText = document.querySelector('#se-prompt-toggle-text');

        const isCollapsed = collapsed !== undefined ? collapsed : accordion.classList.contains('is-collapsed');
        accordion.classList.toggle('is-collapsed', isCollapsed);

        const val = (promptArea?.value || '').trim();
        if (preview) {
            preview.textContent = val ? `— ${val}` : '';
            preview.title = val;
        }
        if (toggleIcon) {
            toggleIcon.textContent = isCollapsed ? 'expand_more' : 'expand_less';
        }
        if (toggleText) {
            toggleText.textContent = isCollapsed ? wt('seq_editor.expand_prompt', 'Развернуть') : wt('seq_editor.collapse_prompt', 'Свернуть');
        }
    }

    getSaveStatusMessage(type = 'saved', options = {}) {
        if (options.message) return options.message;
        if (type === 'dirty') return wt('seq_editor.status_unsaved', 'Не сохранено');
        if (type === 'saved') return wt('seq_editor.status_saved', 'Сохранено');
        return super.getSaveStatusMessage(type, options);
    }

    markUnsaved(options = {}) {
        super.markUnsaved({ message: wt('seq_editor.status_unsaved', 'Не сохранено'), ...options });
        this.updateSaveButtonVisual();
    }

    markSaved(options = {}) {
        super.markSaved({ message: wt('seq_editor.status_saved', 'Сохранено'), ...options });
        this.updateSaveButtonVisual();
    }

    updateSaveButtonVisual() {
        const btn = document.querySelector('#save-task-btn');
        if (!btn) return;
        const isDirty = Boolean(this.hasUnsavedChanges);
        if (isDirty) {
            btn.disabled = false;
            btn.classList.remove('hidden', 'opacity-40', 'cursor-default', 'pointer-events-none');
            btn.classList.add('bg-primary', 'hover:bg-primary-dark', 'text-primary-contrast', 'shadow-sm');
            btn.classList.remove('bg-surface-1', 'border', 'border-border-subtle', 'text-text-secondary', 'hover:text-text-main', 'hover:bg-bg-hover', 'shadow-xs');
        } else {
            btn.disabled = true;
            btn.classList.add('hidden', 'opacity-40', 'cursor-default', 'pointer-events-none');
            btn.classList.remove('bg-primary', 'hover:bg-primary-dark', 'text-primary-contrast', 'shadow-sm');
            btn.classList.add('bg-surface-1', 'border', 'border-border-subtle', 'text-text-secondary', 'hover:text-text-main', 'hover:bg-bg-hover', 'shadow-xs');
        }
    }

    autoResizeField(field) {
        if (!field) return;
        const minHeight = Number(field.dataset.minHeight || 44);
        field.style.height = 'auto';
        const viewportH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 800;
        const maxHeightPx = Math.min(256, Math.max(120, Math.floor(viewportH * 0.36)));
        const target = Math.max(minHeight, Math.min(maxHeightPx, field.scrollHeight));
        field.style.height = `${target}px`;
        if (field.scrollHeight > maxHeightPx) {
            field.style.overflowY = 'auto';
            field.style.maxHeight = `${maxHeightPx}px`;
        } else {
            field.style.overflowY = 'hidden';
            field.style.maxHeight = 'none';
        }
    }

    buildSettingsHelpKey({
        orderInside = false,
        levelOrder = false,
        displayMode = this.displayMode,
    } = {}) {
        if (displayMode === 'hierarchy') {
            if (levelOrder && orderInside) return 'se.hierarchy_help_strict';
            if (levelOrder && !orderInside) return 'se.hierarchy_help_branches_only';
            if (!levelOrder && orderInside) return 'se.hierarchy_help_groups_only';
            return 'se.hierarchy_help_relational';
        }
        if (levelOrder && orderInside) return 'se.k004';
        if (levelOrder && !orderInside) return 'se.k005';
        if (!levelOrder && orderInside) return 'se.k006';
        return 'se.k007';
    }

    buildSettingsHelpHtml({
        orderInside = false,
        levelOrder = false,
        displayMode = this.displayMode,
    } = {}) {
        if (displayMode === 'hierarchy') {
            if (levelOrder && orderInside) {
                return wt('se.hierarchy_help_strict', 'Проверяется точное расположение веток слева направо и порядок элементов внутри конечных групп.');
            }
            if (levelOrder && !orderInside) {
                return wt('se.hierarchy_help_branches_only', 'Важен порядок корневых колонок/веток слева направо. Внутри конечных групп порядок элементов не учитывается.');
            }
            if (!levelOrder && orderInside) {
                return wt('se.hierarchy_help_groups_only', 'Целые ветки и колонки можно менять местами (если дочерние элементы привязаны к своему родителю). Внутри конечных групп важен порядок элементов.');
            }
            return wt('se.hierarchy_help_relational', 'Классификационный режим: целые ветки и колонки взаимозаменяемы, важна только правильная связь «родитель → дочерний элемент» на своём уровне.');
        }
        if (levelOrder && orderInside) {
            return wt('se.k004', 'Требуется соблюдение заданной последовательности уровней и последовательности элементов в каждом уровне.');
        }
        if (levelOrder && !orderInside) {
            return wt('se.k005', 'Важна последовательность уровней. Порядок элементов внутри уровня не учитывается, важна только их принадлежность к уровню.');
        }
        if (!levelOrder && orderInside) {
            return wt('se.k006', 'Важна последовательность элементов в каждом уровне. Последовательность самих уровней не учитывается.');
        }
        return wt('se.k007', 'Важна только принадлежность элементов к соответствующим уровням. Последовательность не учитывается.');
    }

    updateDisplayModeControls(skipPillTransition = false) {
        const isHierarchy = this.displayMode === 'hierarchy';
        const tabLinear = document.querySelector('#mode-tab-linear');
        const tabHierarchy = document.querySelector('#mode-tab-hierarchy');
        const tabsContainer = document.querySelector('#se-display-mode-tabs');
        const pill = document.querySelector('#se-mode-tabs-pill');
        const viewModeBar = document.querySelector('#se-view-mode-bar');
        const toolbar = document.querySelector('#se-hierarchy-toolbar');
        const mainContainer = document.querySelector('#se-main-container');
        const addLevelBtn = document.querySelector('#add-level-btn');
        const addLevelSpan = addLevelBtn?.querySelector('span[data-i18n]');

        if (tabLinear) {
            tabLinear.classList.toggle('is-active', !isHierarchy);
            tabLinear.setAttribute('aria-selected', String(!isHierarchy));
        }
        if (tabHierarchy) {
            tabHierarchy.classList.toggle('is-active', isHierarchy);
            tabHierarchy.setAttribute('aria-selected', String(isHierarchy));
        }
        if (viewModeBar) {
            viewModeBar.classList.toggle('hidden', !isHierarchy);
        }
        if (toolbar) {
            toolbar.classList.toggle('hidden', !isHierarchy);
        }
        document.body.classList.toggle('se-hierarchy-mode', isHierarchy);
        if (mainContainer) {
            mainContainer.classList.toggle('max-w-5xl', !isHierarchy);
            mainContainer.classList.toggle('max-w-full', isHierarchy);
            mainContainer.classList.toggle('p-3', isHierarchy);
            mainContainer.classList.toggle('sm:p-4', isHierarchy);
            mainContainer.classList.toggle('pb-36', !isHierarchy);
            mainContainer.classList.toggle('pb-3', isHierarchy);
        }
        const promptBlock = document.querySelector('[data-onboarding-target="sequence-prompt-block"]');
        const promptArea = document.querySelector('#prompt-textarea');
        if (promptBlock) {
            promptBlock.classList.toggle('mb-2.5', isHierarchy);
            promptBlock.classList.toggle('mb-5', !isHierarchy);
        }
        if (promptArea) {
            promptArea.classList.toggle('se-hierarchy-prompt', isHierarchy);
            promptArea.rows = 2;
            this.adjustPromptHeight(promptArea);
        }
        if (!isHierarchy) {
            this.syncPromptAccordion(false);
        }
        const bottomActions = document.querySelector('#se-bottom-actions');
        if (bottomActions) {
            bottomActions.classList.toggle('hidden', isHierarchy);
        }
        const bottomAddLevelBtn = document.querySelector('#add-level-btn');
        if (bottomAddLevelBtn) {
            bottomAddLevelBtn.classList.toggle('hidden', isHierarchy);
        }
        const helpBtn = document.querySelector('[data-onboarding-help-button]');
        if (helpBtn) {
            helpBtn.setAttribute(
                'data-onboarding-tour-id',
                isHierarchy ? SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID : SEQUENCE_ONBOARDING_TOUR_ID
            );
        }
        if (typeof window !== 'undefined') {
            window.ACTRA_ONBOARDING_HELP = {
                getTourId: () => (this.displayMode === 'hierarchy' ? SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID : SEQUENCE_ONBOARDING_TOUR_ID)
            };
            if (window.OnboardingTour && typeof window.OnboardingTour.refreshHelpButtons === 'function') {
                window.OnboardingTour.refreshHelpButtons();
            }
        }

        // Sliding pill positioning (transitions-dev 16-tabs-sliding)
        const activeTab = isHierarchy ? tabHierarchy : tabLinear;
        if (tabsContainer && pill && activeTab) {
            if (skipPillTransition) {
                tabsContainer.classList.add('is-initial');
            }
            const syncPill = () => {
                const left = activeTab.offsetLeft;
                const targetWidth = activeTab.offsetWidth;
                if (targetWidth > 0) {
                    pill.style.width = `${Math.round(targetWidth * 10) / 10}px`;
                    pill.style.transform = `translateX(${Math.round(left * 10) / 10}px)`;
                }
                if (skipPillTransition) {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => tabsContainer.classList.remove('is-initial'));
                    } else {
                        tabsContainer.classList.remove('is-initial');
                    }
                }
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(syncPill);
            } else {
                syncPill();
            }
        }
    }

    updateSettingsHelpText() {
        const helpText = document.querySelector('#settings-help-text');
        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');
        const isOrderInside = Boolean(orderInside?.checked);
        const isLevelOrder = Boolean(levelOrder?.checked);
        const isColorDiff = true;
        this.colorDifferentiation = true;
        const isHierarchy = this.displayMode === 'hierarchy';

        const orderInsideLabel = document.querySelector('#order-inside-matters-label');
        const orderInsideDesc = document.querySelector('#order-inside-matters-desc');
        const levelOrderLabel = document.querySelector('#level-order-matters-label');
        const levelOrderDesc = document.querySelector('#level-order-matters-desc');

        if (orderInsideLabel) {
            if (isHierarchy) {
                orderInsideLabel.setAttribute('data-i18n', 'se.hierarchy_order_inside_label');
                orderInsideLabel.textContent = wt('se.hierarchy_order_inside_label', 'Порядок элементов внутри конечной группы');
            } else {
                orderInsideLabel.setAttribute('data-i18n', 'seq_editor.order_inside_matters_label');
                orderInsideLabel.textContent = wt('seq_editor.order_inside_matters_label', 'Порядок элементов внутри уровней');
            }
        }
        if (orderInsideDesc) {
            if (isHierarchy) {
                orderInsideDesc.setAttribute('data-i18n', 'se.hierarchy_order_inside_desc');
                orderInsideDesc.textContent = wt('se.hierarchy_order_inside_desc', 'Важна последовательность карточек внутри одного списочного узла');
            } else {
                orderInsideDesc.setAttribute('data-i18n', 'seq_editor.order_inside_matters_desc');
                orderInsideDesc.textContent = wt('seq_editor.order_inside_matters_desc', 'Важна последовательность шагов в каждом уровне');
            }
        }
        if (levelOrderLabel) {
            if (isHierarchy) {
                levelOrderLabel.setAttribute('data-i18n', 'se.hierarchy_level_order_label');
                levelOrderLabel.textContent = wt('se.hierarchy_level_order_label', 'Фиксированный порядок веток и колонок');
            } else {
                levelOrderLabel.setAttribute('data-i18n', 'seq_editor.level_order_matters_label');
                levelOrderLabel.textContent = wt('seq_editor.level_order_matters_label', 'Порядок самих уровней');
            }
        }
        if (levelOrderDesc) {
            if (isHierarchy) {
                levelOrderDesc.setAttribute('data-i18n', 'se.hierarchy_level_order_desc');
                levelOrderDesc.textContent = wt('se.hierarchy_level_order_desc', 'Запрещает менять соседние ветки или колонки таблицы местами');
            } else {
                levelOrderDesc.setAttribute('data-i18n', 'seq_editor.level_order_matters_desc');
                levelOrderDesc.textContent = wt('seq_editor.level_order_matters_desc', 'Важна очередность прохождения самих уровней (этапов)');
            }
        }

        if (helpText) {
            const helpKey = this.buildSettingsHelpKey({
                orderInside: isOrderInside,
                levelOrder: isLevelOrder,
                displayMode: this.displayMode,
            });
            helpText.setAttribute('data-i18n', helpKey);
            helpText.innerHTML = this.buildSettingsHelpHtml({
                orderInside: isOrderInside,
                levelOrder: isLevelOrder,
                displayMode: this.displayMode,
            });
        }

        const modeBadge = document.querySelector('#settings-mode-badge');
        const modeIcon = document.querySelector('#settings-mode-icon');

        let badgeKey = '';
        let badgeText = '';
        let iconName = '';

        if (isLevelOrder && isOrderInside) {
            badgeKey = 'se.mode_strict';
            badgeText = wt('se.mode_strict', 'Строгий порядок');
            iconName = 'verified';
        } else if (isLevelOrder && !isOrderInside) {
            badgeKey = 'se.mode_levels_only';
            badgeText = wt('se.mode_levels_only', 'Порядок уровней');
            iconName = 'low_priority';
        } else if (!isLevelOrder && isOrderInside) {
            badgeKey = 'se.mode_steps_only';
            badgeText = wt('se.mode_steps_only', 'Порядок элементов');
            iconName = 'checklist';
        } else {
            badgeKey = 'se.mode_grouping_only';
            badgeText = wt('se.mode_grouping_only', 'Только группировка');
            iconName = isHierarchy ? 'account_tree' : 'folder_shared';
        }

        if (modeBadge) {
            modeBadge.setAttribute('data-i18n', badgeKey);
            modeBadge.textContent = badgeText;
        }
        if (modeIcon) modeIcon.textContent = iconName;

        const orderInsideCard = orderInside?.closest('.settings-toggle-card');
        const levelOrderCard = levelOrder?.closest('.settings-toggle-card');
        if (orderInsideCard) {
            orderInsideCard.classList.toggle('is-checked', isOrderInside);
        }
        if (levelOrderCard) {
            levelOrderCard.classList.toggle('is-checked', isLevelOrder);
        }
        this.updateDisplayModeControls();
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

    scheduleHistorySave(delayMs = 400) {
        if (this._historySaveTimeout) {
            clearTimeout(this._historySaveTimeout);
        }
        this._historySaveTimeout = setTimeout(() => {
            this._historySaveTimeout = null;
            this.saveStateToHistory();
        }, delayMs);
    }

    flushPendingHistorySave() {
        if (this._historySaveTimeout) {
            clearTimeout(this._historySaveTimeout);
            this._historySaveTimeout = null;
            this.saveStateToHistory();
        }
    }

    checkpointHistoryBeforeMutation() {
        this.flushPendingHistorySave();
        if (!this.undoManager || typeof this.undoManager.getHistorySize !== 'function') return;
        if (this.undoManager.getHistorySize() === 0) {
            this.undoManager.pushState(this.captureState());
            this.updateUndoRedoButtons();
            return;
        }
        const currentState = this.captureState();
        const topState = this.undoManager.history[this.undoManager.currentIndex];
        if (JSON.stringify(currentState) !== JSON.stringify(topState)) {
            this.undoManager.pushState(currentState);
            this.updateUndoRedoButtons();
        }
    }

    shouldDelegateUndoRedoFromInput(target) {
        if (!target) return false;
        if (target.classList?.contains('block-title-input') || 
            target.classList?.contains('se-node-item-input') ||
            target.classList?.contains('sequence-block-title') ||
            target.closest?.('.se-node-card') ||
            target.closest?.('.sequence-block-card')) {
            return true;
        }
        return false;
    }

    performUndo() {
        this.flushPendingHistorySave();
        super.performUndo();
    }

    performRedo() {
        this.flushPendingHistorySave();
        super.performRedo();
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
        this.updateTaskTitleDisplay();
        this.setupSequenceOnboardingTourBridge();
        this.setupEventListeners();
        if (this.undoManager && typeof this.undoManager.getHistorySize === 'function' && this.undoManager.getHistorySize() === 0) {
            this.saveStateToHistory();
        }
        if (typeof window !== 'undefined' && window.innerWidth <= 1150) {
            this.toggleSidebar(false);
        }
    }

    ensureSequenceOnboardingPreviewTask() {
        if (!this.sequenceOnboardingPreview) return;

        const isHierarchyTour = this.onboardingPreviewTourId === SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID;
        this.moduleId = this.moduleId || 'onboarding-preview-module';
        this.topicId = this.topicId || 'onboarding-preview-topic';
        this.taskId = this.taskId || (isHierarchyTour ? 'onboarding-preview-sequence-hierarchy' : 'onboarding-preview-sequence');
        this.isNewTaskParam = true;
        this.hasPersistedTask = false;
        const taskName = isHierarchyTour
            ? wt('sequence_editor.demo.hierarchy_title', 'Классификация: стратификация риска ТЭЛА')
            : wt('sequence_editor.demo.solution_prep_title', 'Приготовление рабочего раствора');
        this.task = {
            task_data: {
                id: this.taskId,
                type: 'sequence_assembly',
                name: taskName,
                content: {},
                settings: {},
                meta: {
                    id: this.taskId,
                    module: this.moduleId,
                    topic: this.topicId,
                    name: taskName,
                },
            },
            metadata: {
                id: this.taskId,
                module: this.moduleId,
                topic: this.topicId,
                name: taskName,
                type: 'sequence_assembly',
            },
        };
    }

    createSequenceOnboardingContent() {
        return {
            prompt: wt('sequence_editor.demo.prompt', 'Расположите этапы приготовления раствора по двум уровням: подготовка и выполнение.'),
            sequence_within_level_matters: true,
            level_order_matters: true,
            elements: [
                { id: 'seq_elem_check_flask', text: wt('sequence_editor.demo.step_check_flask', 'Проверить мерную колбу'), semantic_key: 'text:check_flask' },
                { id: 'seq_elem_measure_solvent', text: wt('sequence_editor.demo.step_measure_solvent', 'Отмерить растворитель'), semantic_key: 'text:measure_solvent' },
                { id: 'seq_elem_add_substance', text: wt('sequence_editor.demo.step_add_substance', 'Добавить вещество'), semantic_key: 'text:add_substance' },
                { id: 'seq_elem_mix_solution', text: wt('sequence_editor.demo.step_mix_solution', 'Перемешать раствор'), semantic_key: 'text:mix_solution' },
            ],
            levels: [
                {
                    level_id: 'seq_level_prepare',
                    level_name: wt('sequence_editor.demo.level_prepare', 'Подготовка'),
                    blocks: ['seq_elem_check_flask', 'seq_elem_measure_solvent'],
                },
                {
                    level_id: 'seq_level_execute',
                    level_name: wt('sequence_editor.demo.level_execute', 'Выполнение'),
                    blocks: ['seq_elem_add_substance', 'seq_elem_mix_solution'],
                },
            ],
        };
    }

    createSequenceHierarchyOnboardingContent() {
        return {
            prompt: wt('sequence_editor.demo.hierarchy_prompt', 'Классифицируйте категории риска ТЭЛА, сопоставив клинический статус и инструментальные признаки:'),
            sequence_within_level_matters: true,
            level_order_matters: true,
            display_mode: 'hierarchy',
            elements: [
                { id: 'seq_elem_high_phe', text: wt('sequence_editor.demo.h_elem_high_phe', 'Шок, гипотензия (систолическое АД < 90 мм рт.ст.)'), semantic_key: 'text:high_phe' },
                { id: 'seq_elem_high_img', text: wt('sequence_editor.demo.h_elem_high_img', 'Массивный седловидный тромбоз, дилатация ПЖ > 1.0'), semantic_key: 'text:high_img' },
                { id: 'seq_elem_non_high_phe', text: wt('sequence_editor.demo.h_elem_non_high_phe', 'Нормотензия, стабильная системная гемодинамика'), semantic_key: 'text:non_high_phe' },
                { id: 'seq_elem_non_high_img', text: wt('sequence_editor.demo.h_elem_non_high_img', 'Сегментарные дефекты без дилатации правого желудочка'), semantic_key: 'text:non_high_img' },
            ],
            levels: [
                {
                    level_id: 'seq_level_status',
                    level_name: wt('sequence_editor.demo.tier_status', 'Клинический статус'),
                    blocks: ['seq_elem_high_phe', 'seq_elem_non_high_phe'],
                },
                {
                    level_id: 'seq_level_imaging',
                    level_name: wt('sequence_editor.demo.tier_imaging', 'КТ-ангиография и ЭхоКГ'),
                    blocks: ['seq_elem_high_img', 'seq_elem_non_high_img'],
                },
            ],
            nodes: [
                {
                    node_id: 'node_high_risk',
                    level_id: 'seq_level_status',
                    column_title: wt('sequence_editor.demo.col_high_risk', 'Высокий риск'),
                    blocks: ['seq_elem_high_phe'],
                },
                {
                    node_id: 'node_high_img',
                    level_id: 'seq_level_imaging',
                    parent_id: 'node_high_risk',
                    blocks: ['seq_elem_high_img'],
                },
                {
                    node_id: 'node_non_high_risk',
                    level_id: 'seq_level_status',
                    column_title: wt('sequence_editor.demo.col_non_high_risk', 'Невысокий риск'),
                    blocks: ['seq_elem_non_high_phe'],
                },
                {
                    node_id: 'node_non_high_img',
                    level_id: 'seq_level_imaging',
                    parent_id: 'node_non_high_risk',
                    blocks: ['seq_elem_non_high_img'],
                },
            ],
        };
    }

    applySequenceOnboardingPreviewState(tourId) {
        if ((!this.sequenceOnboardingPreview && !this.sequenceOnboardingDemoActive) || !this.task) return;

        const effectiveTourId = String(tourId || this.activeOnboardingTourId || this.onboardingPreviewTourId || '').trim();
        const isHierarchyTour = effectiveTourId === SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID;

        if (!this.task.task_data) this.task.task_data = {};
        if (!this.task.task_data.meta) this.task.task_data.meta = {};
        if (!this.task.metadata) this.task.metadata = {};

        if (isHierarchyTour) {
            const hTitle = wt('sequence_editor.demo.hierarchy_title', 'Классификация: стратификация риска ТЭЛА');
            this.task.task_data.name = hTitle;
            this.task.task_data.type = 'sequence_assembly';
            this.task.task_data.meta.name = hTitle;
            this.task.metadata.name = hTitle;
            this.task.metadata.type = 'sequence_assembly';
            this.task.task_data.content = this.createSequenceHierarchyOnboardingContent();
            this.task.task_data.settings = {
                ...(this.task.task_data.settings || {}),
                sequence_within_level_matters: true,
                level_order_matters: true,
                display_mode: 'hierarchy',
            };
            this.displayMode = 'hierarchy';
            this.colorDifferentiation = true;
            this.levels = this.parseLevels(this.task.task_data.content);
            this.nodes = this.parseNodes(this.task.task_data.content, this.levels);
        } else {
            const sTitle = wt('sequence_editor.demo.solution_prep_title', 'Последовательность: приготовление раствора');
            this.task.task_data.name = sTitle;
            this.task.task_data.type = 'sequence_assembly';
            this.task.task_data.meta.name = sTitle;
            this.task.metadata.name = sTitle;
            this.task.metadata.type = 'sequence_assembly';
            this.task.task_data.content = this.createSequenceOnboardingContent();
            this.task.task_data.settings = {
                ...(this.task.task_data.settings || {}),
                sequence_within_level_matters: true,
                level_order_matters: true,
                display_mode: 'linear',
            };
            this.displayMode = 'linear';
            this.colorDifferentiation = true;
            this.levels = this.parseLevels(this.task.task_data.content);
            this.nodes = [];
        }

        this.ensureDefaultStructure();
        this.renderUI();
        this.updateDisplayModeControls(true);
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[SequenceEditor] difficulty authoring preview refresh failed', error);
        });
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    resetSequenceOnboardingPreviewState() {
        if (!this.sequenceOnboardingPreview || !this.task || this.sequenceOnboardingFinished) return;
        this.sequenceOnboardingFinished = true;
        if (!this.task.task_data) this.task.task_data = {};
        this.task.task_data.content = {
            prompt: '',
            sequence_within_level_matters: true,
            level_order_matters: false,
            elements: [],
            levels: [],
        };
        this.task.task_data.settings = {
            ...(this.task.task_data.settings || {}),
            sequence_within_level_matters: true,
            level_order_matters: false,
        };
        this.levels = [this.createEmptyLevel()];
        this.renderUI();
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[SequenceEditor] difficulty authoring reset refresh failed', error);
        });
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

    applySequenceOnboardingDemoState(tourId) {
        if (!this.task) return;
        document.querySelectorAll('.fixed.inset-0.z-50, .empty-state-card').forEach((el) => {
            if (el.querySelector('.empty-state-card') || el.classList.contains('empty-state-card')) {
                el.remove();
            }
        });
        if (this.sequenceOnboardingPreview) {
            this.activeOnboardingTourId = tourId || SEQUENCE_ONBOARDING_TOUR_ID;
            this.applySequenceOnboardingPreviewState(this.activeOnboardingTourId);
            return;
        }
        if (!this.sequenceOnboardingDemoSnapshot) {
            this.sequenceOnboardingDemoSnapshot = {
                task: this.cloneSequenceOnboardingValue(this.task),
                levels: this.cloneSequenceOnboardingValue(this.levels),
                nodes: this.cloneSequenceOnboardingValue(this.nodes),
                displayMode: this.displayMode,
                colorDifferentiation: this.colorDifferentiation,
                hasUnsavedChanges: this.hasUnsavedChanges,
            };
        }
        this.sequenceOnboardingDemoActive = true;
        this.activeOnboardingTourId = tourId || SEQUENCE_ONBOARDING_TOUR_ID;
        this.applySequenceOnboardingPreviewState(this.activeOnboardingTourId);
    }

    restoreSequenceOnboardingDemoState() {
        const snapshot = this.sequenceOnboardingDemoSnapshot;
        this.sequenceOnboardingDemoSnapshot = null;
        this.sequenceOnboardingDemoActive = false;
        this.activeOnboardingTourId = null;
        if (!snapshot) return;
        this.task = this.cloneSequenceOnboardingValue(snapshot.task);
        this.levels = this.cloneSequenceOnboardingValue(snapshot.levels) || [];
        this.nodes = this.cloneSequenceOnboardingValue(snapshot.nodes) || [];
        this.displayMode = snapshot.displayMode || 'linear';
        this.colorDifferentiation = snapshot.colorDifferentiation !== undefined ? snapshot.colorDifferentiation : true;
        this.renderUI();
        this.updateDisplayModeControls(true);
        this.refreshDifficultyAuthoringControls().catch((error) => {
            console.warn('[SequenceEditor] difficulty authoring restore refresh failed', error);
        });
        this.hasUnsavedChanges = Boolean(snapshot.hasUnsavedChanges);
        this.updateSaveStatus();
    }

    setupSequenceOnboardingTourBridge() {
        const isSupportedTour = (id) => id === SEQUENCE_ONBOARDING_TOUR_ID || id === SEQUENCE_HIERARCHY_ONBOARDING_TOUR_ID;

        window.addEventListener('onboarding:before-start', (event) => {
            const detail = event?.detail || {};
            if (!isSupportedTour(detail.tourId)) return;
            document.querySelectorAll('.fixed.inset-0.z-50, .empty-state-card').forEach((el) => {
                if (el.querySelector('.empty-state-card') || el.classList.contains('empty-state-card')) {
                    el.remove();
                }
            });
            if (this.sequenceOnboardingPreview) {
                this.activeOnboardingTourId = detail.tourId;
                this.applySequenceOnboardingPreviewState(detail.tourId);
                return;
            }
            this.applySequenceOnboardingDemoState(detail.tourId);
        });

        window.addEventListener('onboarding:finish', (event) => {
            const detail = event?.detail || {};
            if (!isSupportedTour(detail.tourId)) return;
            const nextTourId = String(detail.nextTourId || '').trim();
            if (isSupportedTour(nextTourId)) {
                this.activeOnboardingTourId = nextTourId;
                this.applySequenceOnboardingPreviewState(nextTourId);
                return;
            }
            if (!this.sequenceOnboardingPreview) {
                this.restoreSequenceOnboardingDemoState();
                return;
            }
            this.resetSequenceOnboardingPreviewState();
        });
    }

    getDifficultyAuthoringMountPoint() {
        return document.querySelector('#editor-difficulty-authoring-mount')
            || document.querySelector('#sequence-sidebar-content')
            || document.querySelector('aside .p-5.space-y-6')
            || document.querySelector('aside .p-6.space-y-8');
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
        if (this.task?.task_data && !this.task.task_data.type) {
            this.task.task_data.type = this.task.task_data.task_type
                || this.task.metadata?.type
                || this.taskTypeParam
                || 'sequence_assembly';
        }
        const content = this.task.task_data.content || {};
        const settings = this.task.task_data.settings || {};
        const rawMode = String(content.display_mode || settings.display_mode || '').trim().toLowerCase();
        const loadedUrlParams = (typeof window !== 'undefined' && window.location?.search)
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        const urlInitialMode = String(loadedUrlParams.get('initial_mode') || loadedUrlParams.get('subtype') || '').trim().toLowerCase();
        if (rawMode === 'hierarchy' || (Array.isArray(content.nodes) && content.nodes.length > 0 && rawMode !== 'linear')) {
            this.displayMode = 'hierarchy';
        } else if (rawMode === 'linear') {
            this.displayMode = 'linear';
        } else if (this.isNewTaskParam && urlInitialMode === 'hierarchy') {
            this.displayMode = 'hierarchy';
            if (this.task?.task_data?.content) {
                this.task.task_data.content.display_mode = 'hierarchy';
            }
        } else {
            this.displayMode = 'linear';
        }
        this.colorDifferentiation = true;
        this.levels = this.parseLevels(content);
        this.nodes = this.parseNodes(content, this.levels);
        this.ensureDefaultStructure();
        this.renderUI();
        if (this.undoManager && typeof this.undoManager.getHistorySize === 'function' && this.undoManager.getHistorySize() === 0) {
            this.saveStateToHistory();
        }
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

    parseNodes(content, levels = this.levels) {
        if (!Array.isArray(content?.nodes) || !content.nodes.length) {
            return [];
        }
        const elements = Array.isArray(content.elements) ? content.elements : [];
        const elementsById = new Map(elements.map(el => [el.id, el]));
        const knownLevelIds = new Set((levels || []).map(l => l.levelId));

        return content.nodes.map((rawNode) => {
            const nodeId = String(rawNode.node_id || rawNode.nodeId || rawNode.id || '').trim() || this.generateId('node');
            let levelId = String(rawNode.level_id || rawNode.levelId || '').trim();
            if (!levelId) {
                const fallbackLvl = (levels && levels[0]) || this.createEmptyLevel();
                if (!levels.length) levels.push(fallbackLvl);
                levelId = fallbackLvl.levelId;
                knownLevelIds.add(levelId);
            } else if (!knownLevelIds.has(levelId)) {
                levels.push({
                    levelId,
                    title: '',
                    items: [this.createEmptyItem()]
                });
                knownLevelIds.add(levelId);
            }

            const parentId = rawNode.parent_id || rawNode.parentId || null;
            let items = [];
            if (Array.isArray(rawNode.blocks) && rawNode.blocks.length) {
                items = rawNode.blocks.map((blockId) => {
                    const element = elementsById.get(blockId) || {};
                    return {
                        id: blockId || this.generateId('elem'),
                        label: element.text || '',
                        image: element.image || null,
                        semanticKey: itemSemanticFromElement(element)
                    };
                });
            } else if (Array.isArray(rawNode.items) && rawNode.items.length) {
                items = rawNode.items.map((item) => ({
                    id: item.id || this.generateId('elem'),
                    label: item.label || item.text || '',
                    image: item.image || null,
                    semanticKey: item.semantic_key || item.semanticKey || null
                }));
            }

            const columnTitle = String(rawNode.column_title || rawNode.columnTitle || '').trim();

            return {
                nodeId,
                levelId,
                parentId: parentId ? String(parentId).trim() : null,
                items: items.length ? items : [this.createEmptyItem()],
                columnTitle
            };
        });

        function itemSemanticFromElement(element) {
            return element.semantic_key || element.semanticKey || null;
        }
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
            this.adjustPromptHeight(promptArea);
            const isHierarchy = this.displayMode === 'hierarchy';
            const compactViewport = typeof window !== 'undefined' && window.innerHeight <= 800;
            if (isHierarchy && compactViewport && promptArea.value.trim()) {
                this.syncPromptAccordion(true);
            } else {
                this.syncPromptAccordion(false);
            }
        }

        const orderInside = document.querySelector('#order-inside-matters');
        const levelOrder = document.querySelector('#level-order-matters');
        const content = this.task.task_data.content || {};
        const settings = this.task.task_data.settings || {};

        if (orderInside) {
            const sequenceMatters = content.sequence_within_level_matters;
            orderInside.checked = sequenceMatters !== false;
        }
        if (levelOrder) {
            const levelOrderMatters = content.level_order_matters;
            levelOrder.checked = levelOrderMatters !== false;
        }
        this.colorDifferentiation = true;

        this.updateDisplayModeControls(true);
        this.renderLevels();
        this.updateSettingsHelpText();
        this.markSaved();
    }

    async setDisplayMode(mode) {
        const nextMode = mode === 'hierarchy' ? 'hierarchy' : 'linear';
        if (nextMode === this.displayMode) {
            this.updateDisplayModeControls(false);
            return;
        }
        const hasCustomContent = Array.isArray(this.nodes) && this.nodes.some(n => Array.isArray(n.items) && n.items.some(it => String(it.label || '').trim().length > 0));
        if (this.displayMode === 'hierarchy' && nextMode === 'linear' && hasCustomContent) {
            const confirmed = await this.confirmAction({
                title: wt('se.confirm_switch_linear_title', 'Переключить в линейный режим?'),
                message: wt('se.confirm_switch_linear_msg', 'Древовидная структура связей будет представлена как плоские этапы. Вы сможете вернуть схему кнопкой «Отменить» в шапке или нажатием Ctrl+Z.'),
                confirmText: wt('se.confirm_switch_linear_btn', 'Переключить'),
                cancelText: wt('editor_base.modal.cancel_btn', 'Отмена'),
                variant: 'warning',
            });
            if (!confirmed) {
                this.updateDisplayModeControls(false);
                return;
            }
        }
        this.checkpointHistoryBeforeMutation();
        const wasDirty = this.hasUnsavedChanges;
        if (nextMode === 'hierarchy') {
            this.displayMode = 'hierarchy';
            if (!Array.isArray(this.nodes) || !this.nodes.length) {
                this.syncNodesFromLevels();
            } else {
                this.syncLevelsFromNodes();
            }
            const orderInside = document.querySelector('#order-inside-matters');
            const levelOrder = document.querySelector('#level-order-matters');
            const isFresh = this.levels.every(l => l.items.every(it => !String(it.label || '').trim()));
            if (isFresh) {
                if (orderInside) orderInside.checked = false;
                if (levelOrder) levelOrder.checked = false;
            }
        } else {
            this.syncLevelsFromNodes();
            this.displayMode = 'linear';
        }
        this.updateDisplayModeControls(false);
        this.updateSettingsHelpText();
        this.renderLevels();
        const isFresh = this.levels.every(l => l.items.every(it => !String(it.label || '').trim()));
        if (!wasDirty && isFresh) {
            this.hasUnsavedChanges = false;
            this.updateSaveStatus();
        } else {
            this.markUnsaved();
        }
        this.saveStateToHistory();
    }

    renderLevels() {
        const container = document.querySelector('#levels-container');
        if (!container) return;

        this.ensureDefaultStructure();
        container.innerHTML = '';

        const bottomActions = document.querySelector('#se-bottom-actions');
        if (this.displayMode === 'hierarchy') {
            if (bottomActions) bottomActions.classList.add('hidden');
            this.renderHierarchyCanvas(container);
            this.updateClearAllButtonState();
            return;
        } else {
            if (bottomActions) bottomActions.classList.remove('hidden');
        }

        this.levels.forEach((level, lIndex) => {
            const levelEl = this.createLevelElement(level, lIndex);
            container.appendChild(levelEl);
        });

        this.updateClearAllButtonState();

        // Ensure all textarea heights are measured accurately after mounting into DOM tree
        const doResize = () => {
            container.querySelectorAll('.block-title-input').forEach((field) => {
                this.autoResizeField(field);
            });
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(doResize);
        } else {
            setTimeout(doResize, 0);
        }
    }

    async handleClearAll() {
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
            this.nodes = [];
            if (this.displayMode === 'hierarchy') {
                this.syncNodesFromLevels();
            }
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory();
            this.showToast(wt('se.k030', 'Редактор очищен. При необходимости нажмите Ctrl+Z, чтобы вернуть предыдущую структуру.'), 'info', 5200);
        }
    }

    updateClearAllButtonState() {
        const hasColumnTitles = Array.isArray(this.nodes) && this.nodes.some(n => Boolean((n.columnTitle || '').trim()));
        const isBlank = this.levels.length === 1 &&
            !this.levels[0].title &&
            !hasColumnTitles &&
            (this.levels[0].items.length === 0 || (this.levels[0].items.length === 1 && !this.levels[0].items[0].label));
        const clearBtns = document.querySelectorAll('#clear-all-btn, .clear-all-top-btn');
        clearBtns.forEach((btn) => {
            btn.disabled = isBlank;
            if (isBlank) {
                btn.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
            } else {
                btn.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
            }
        });
    }

    createLevelElement(level, lIndex) {
        const div = document.createElement('div');
        div.className = 'sequence-level-card card-elevated rounded-2xl p-4 sm:p-5 group/level relative mb-6 transition-all';
        div.setAttribute('data-onboarding-spotlight', 'frame');
        div.setAttribute('data-onboarding-target', lIndex === 0 ? 'sequence-first-level' : `sequence-level-${lIndex + 1}`);
        if (this.colorDifferentiation) {
            div.setAttribute('data-color-tint', String(lIndex % 6));
        } else {
            div.removeAttribute('data-color-tint');
        }
        if (level.levelId) {
            div.style.viewTransitionName = `level-${level.levelId}`;
        }

        const totalLevels = this.levels.length;
        const isSingleLevel = totalLevels <= 1;
        const isFirstLevel = lIndex === 0;
        const isLastLevel = lIndex === totalLevels - 1;

        div.innerHTML = `
            <div class="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-border-subtle">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="sequence-level-index w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0">
                        ${lIndex + 1}
                    </div>
                    <input class="level-title-input flex-1 min-w-[140px]" 
                           type="text" data-i18n-placeholder="se.k008" placeholder="${wt('se.k008', 'Название уровня')}"/>
                    <span class="sequence-level-title-onboarding-anchor absolute pointer-events-none" aria-hidden="true"></span>
                    <span class="sequence-level-title-onboarding-edge absolute pointer-events-none" aria-hidden="true"></span>
                </div>
                <div class="sequence-level-actions flex items-center gap-1 transition-opacity">
                    <button class="move-up icon-button-muted disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none" ${isFirstLevel || isSingleLevel ? 'disabled' : ''} data-i18n-title="se.k009" title="${wt('se.k009', 'Переместить вверх')}" aria-label="${wt('se.k009', 'Переместить вверх')} (${wt('se.k008', 'Уровень')} ${lIndex + 1})"><span class="material-symbols-outlined text-[18px]">arrow_upward</span></button>
                    <button class="move-down icon-button-muted disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none" ${isLastLevel || isSingleLevel ? 'disabled' : ''} data-i18n-title="se.k010" title="${wt('se.k010', 'Переместить вниз')}" aria-label="${wt('se.k010', 'Переместить вниз')} (${wt('se.k008', 'Уровень')} ${lIndex + 1})"><span class="material-symbols-outlined text-[18px]">arrow_downward</span></button>
                    <div class="w-px h-5 bg-border-subtle mx-1"></div>
                    <button class="delete-level icon-button-muted border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none" ${isSingleLevel ? 'disabled' : ''} data-i18n-title="se.k011" title="${wt('se.k011', 'Удалить уровень')}" aria-label="${wt('se.k011', 'Удалить уровень')} ${lIndex + 1}"><span class="material-symbols-outlined text-[18px]">close</span></button>
                </div>
            </div>
            <div class="sequence-items-grid items-container"></div>
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
                titleAnchor.style.left = '64px';
                titleAnchor.style.top = '18px';
                titleAnchor.style.width = `${titleWidth}px`;
                titleAnchor.style.height = '32px';

                const titleEdge = div.querySelector('.sequence-level-title-onboarding-edge');
                if (titleEdge) {
                    titleEdge.setAttribute('data-onboarding-target', 'sequence-first-level-title-edge');
                    titleEdge.style.left = `${64 + titleWidth - 6}px`;
                    titleEdge.style.top = '18px';
                    titleEdge.style.width = '6px';
                    titleEdge.style.height = '32px';
                }

            }
        }
        titleInput.oninput = (e) => {
            this.levels[lIndex].title = e.target.value;
            this.markUnsaved();
            this.updateClearAllButtonState();
            this.scheduleHistorySave(400);
        };
        titleInput.onblur = () => {
            this.flushPendingHistorySave();
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
        addButton.className = 'sequence-add-block-btn empty-state-card empty-state-card--compact empty-state-card--icon-only rounded-xl border-2 border-dashed border-border-strong hover:border-primary hover:bg-primary-lighter/40 flex flex-col items-center justify-center gap-1.5 p-4 min-h-[140px] text-text-muted hover:text-primary transition-all duration-200 cursor-pointer';
        addButton.setAttribute('data-i18n-title', 'se.k012');
        addButton.title = wt('se.k012', 'Добавить шаг в этот уровень');
        addButton.setAttribute('data-i18n-aria', 'se.k013');
        addButton.setAttribute('aria-label', wt('se.k013', 'Добавить блок'));
        if (lIndex === 0) {
            addButton.setAttribute('data-onboarding-target', 'sequence-first-level-add-step');
        }
        addButton.innerHTML = '<span class="material-symbols-outlined text-[28px]">add</span><span class="text-xs font-semibold tracking-wide" data-i18n="seq_editor.add_step_btn">' + wt('seq_editor.add_step_btn', 'Добавить шаг') + '</span>';
        addButton.onclick = () => this.addBlock(lIndex);
        itemsContainer.appendChild(addButton);

        return div;
    }

    // ===== HIERARCHY / CLASSIFICATION CANVAS & MATRIX METHODS =====

    computeHierarchyLayout() {
        this.ensureDefaultStructure();
        const tierIndexByLevelId = new Map(this.levels.map((l, idx) => [l.levelId, idx]));
        const nodeById = new Map();
        this.nodes.forEach((n) => {
            if (!n.nodeId) n.nodeId = this.generateId('node');
            if (!tierIndexByLevelId.has(n.levelId)) {
                n.levelId = this.levels[0].levelId;
            }
            nodeById.set(n.nodeId, n);
        });

        const childrenByParentId = new Map();
        const rootNodes = [];

        this.nodes.forEach((node) => {
            const pid = node.parentId;
            if (pid && pid !== node.nodeId && nodeById.has(pid)) {
                if (!childrenByParentId.has(pid)) {
                    childrenByParentId.set(pid, []);
                }
                childrenByParentId.get(pid).push(node);
            } else {
                node.parentId = null;
                rootNodes.push(node);
            }
        });

        const spanByNodeId = new Map();
        const computeSpan = (node, visited = new Set()) => {
            if (visited.has(node.nodeId)) return 1;
            if (spanByNodeId.has(node.nodeId)) return spanByNodeId.get(node.nodeId);
            visited.add(node.nodeId);
            const children = childrenByParentId.get(node.nodeId) || [];
            if (!children.length) {
                spanByNodeId.set(node.nodeId, 1);
                return 1;
            }
            let sum = 0;
            children.forEach((child) => {
                sum += computeSpan(child, new Set(visited));
            });
            const span = Math.max(1, sum);
            spanByNodeId.set(node.nodeId, span);
            return span;
        };

        rootNodes.forEach(r => computeSpan(r));
        this.nodes.forEach(n => {
            if (!spanByNodeId.has(n.nodeId)) computeSpan(n);
        });

        const colStartByNodeId = new Map();
        const rootIdxByNodeId = new Map();
        let nextCol = 1;

        const assignCols = (node, colStart, rootIdx, visited = new Set()) => {
            if (visited.has(node.nodeId)) return;
            visited.add(node.nodeId);
            colStartByNodeId.set(node.nodeId, colStart);
            rootIdxByNodeId.set(node.nodeId, rootIdx);
            const children = childrenByParentId.get(node.nodeId) || [];
            let childCol = colStart;
            children.forEach((child) => {
                assignCols(child, childCol, rootIdx, new Set(visited));
                childCol += (spanByNodeId.get(child.nodeId) || 1);
            });
        };

        rootNodes.forEach((root, rIdx) => {
            assignCols(root, nextCol, rIdx);
            nextCol += (spanByNodeId.get(root.nodeId) || 1);
        });

        const totalCols = Math.max(1, nextCol - 1);
        const nodesByTier = this.levels.map(() => []);
        this.nodes.forEach((node) => {
            const tIdx = tierIndexByLevelId.get(node.levelId) ?? 0;
            const children = childrenByParentId.get(node.nodeId) || [];
            const siblings = node.parentId
                ? (childrenByParentId.get(node.parentId) || [])
                : rootNodes;
            const siblingIndex = siblings.indexOf(node);
            nodesByTier[tIdx].push({
                node,
                tierIndex: tIdx,
                colStart: colStartByNodeId.get(node.nodeId) || 1,
                colSpan: spanByNodeId.get(node.nodeId) || 1,
                rootIndex: rootIdxByNodeId.get(node.nodeId) ?? 0,
                hasChildren: children.length > 0,
                childrenCount: children.length,
                siblingIndex: siblingIndex >= 0 ? siblingIndex : 0,
                siblingCount: siblings.length,
            });
        });

        nodesByTier.forEach((tierList) => {
            tierList.sort((a, b) => a.colStart - b.colStart);
        });

        return {
            totalCols,
            nodesByTier,
            childrenByParentId,
            rootNodes,
            nodeById,
            tierIndexByLevelId,
            colStartByNodeId,
            spanByNodeId,
            rootIdxByNodeId,
        };
    }

    renderHierarchyCanvas(container) {
        const layout = this.computeHierarchyLayout();
        this.syncLevelsFromNodes();

        // Preserve scroll position to eliminate abrupt jumps on mutation
        const existingViewport = container.querySelector('#se-hierarchy-viewport');
        const prevScrollLeft = existingViewport ? existingViewport.scrollLeft : (this._savedScrollLeft || 0);
        const prevScrollTop = existingViewport ? existingViewport.scrollTop : (this._savedScrollTop || 0);

        // Clean up previous window listeners to prevent leaks
        if (typeof this._hierarchyWindowCleanup === 'function') {
            this._hierarchyWindowCleanup();
            this._hierarchyWindowCleanup = null;
        }

        const shell = document.createElement('div');
        shell.className = 'se-hierarchy-shell';
        shell.setAttribute('data-color-diff', this.colorDifferentiation ? 'true' : 'false');

        const topActions = document.createElement('div');
        topActions.id = 'se-hierarchy-toolbar';
        topActions.className = 'se-canvas-top-bar flex items-center justify-between gap-3 px-4 py-2 bg-surface-1 border-b border-border-subtle text-xs';
        topActions.setAttribute('data-onboarding-target', 'sequence-hierarchy-toolbar');
        topActions.innerHTML = `
            <div class="flex items-center gap-2">
                <button type="button" data-onboarding-target="sequence-hierarchy-add-tier" class="add-tier-top-btn btn-secondary btn-secondary--compact inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-main border border-border-subtle bg-surface-2 hover:border-primary/40 hover:text-primary cursor-pointer transition-all shadow-xs">
                    <span class="material-symbols-outlined text-[16px] text-primary">add_circle</span>
                    <span data-i18n="se.btn_add_tier">${wt('se.btn_add_tier', '+ Добавить уровень')}</span>
                </button>
                <button type="button" data-onboarding-target="sequence-hierarchy-add-column" class="add-root-node-btn btn-secondary btn-secondary--compact inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary border border-primary/30 bg-primary-lighter/50 hover:bg-primary-lighter cursor-pointer transition-all shadow-xs">
                    <span class="material-symbols-outlined text-[16px]">view_column</span>
                    <span data-i18n="se.btn_add_column">${wt('se.btn_add_column', '+ Колонка')}</span>
                </button>
                <div class="w-px h-3.5 bg-border-subtle mx-0.5"></div>
                <button type="button" class="clear-all-top-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-error hover:bg-error-lighter/30 border border-transparent hover:border-error/20 cursor-pointer transition-colors" data-i18n-title="seq_editor.clear_all_btn" title="${wt('seq_editor.clear_all_btn', 'Очистить всё')}">
                    <span class="material-symbols-outlined text-[16px]">delete_sweep</span>
                    <span data-i18n="seq_editor.clear_all_btn">${wt('seq_editor.clear_all_btn', 'Очистить всё')}</span>
                </button>
            </div>
            <div class="flex items-center gap-2">
                <div class="se-zoom-controls inline-flex items-center rounded-lg border border-border-subtle bg-surface-2 p-0.5">
                    <button type="button" id="se-zoom-out" class="se-zoom-btn" data-i18n-title="seq.zoom_out" data-i18n-aria="seq.zoom_out" title="${wt('seq.zoom_out', 'Отдалить')}" aria-label="${wt('seq.zoom_out', 'Отдалить')}">
                        <span class="material-symbols-outlined text-[16px]">remove</span>
                    </button>
                    <input type="range" id="se-zoom-slider" class="se-zoom-slider" min="40" max="150" step="1" value="${Math.round(this.canvasZoom * 100)}" data-i18n-title="seq.zoom_slider" data-i18n-aria="seq.zoom_slider" title="${wt('seq.zoom_slider', 'Масштаб холста')}" aria-label="${wt('seq.zoom_slider', 'Масштаб холста')}">
                    <button type="button" id="se-zoom-in" class="se-zoom-btn" data-i18n-title="seq.zoom_in" data-i18n-aria="seq.zoom_in" title="${wt('seq.zoom_in', 'Приблизить')}" aria-label="${wt('seq.zoom_in', 'Приблизить')}">
                        <span class="material-symbols-outlined text-[16px]">add</span>
                    </button>
                    <button type="button" id="se-zoom-reset" class="se-zoom-label px-1.5 py-0.5 text-xs font-mono font-medium text-text-secondary hover:text-text-main rounded hover:bg-surface-3 transition-colors cursor-pointer" data-i18n-title="seq.zoom_reset" title="${wt('seq.zoom_reset', 'Сбросить масштаб (100%)')}">
                        ${Math.round(this.canvasZoom * 100)}%
                    </button>
                    <div class="w-px h-3.5 bg-border-subtle mx-0.5"></div>
                    <button type="button" id="se-zoom-fit" class="se-zoom-btn" data-i18n-title="seq.zoom_fit" data-i18n-aria="seq.zoom_fit" title="${wt('seq.zoom_fit', 'Вписать в экран')}" aria-label="${wt('seq.zoom_fit', 'Вписать в экран')}">
                        <span class="material-symbols-outlined text-[16px]">fit_screen</span>
                    </button>
                    <button type="button" id="se-minimap-toggle" class="se-zoom-btn${this.minimapVisible ? ' is-active' : ''}" data-i18n-title="seq.minimap_toggle" data-i18n-aria="seq.minimap_toggle" title="${wt('seq.minimap_toggle', 'Миникарта схемы')}" aria-label="${wt('seq.minimap_toggle', 'Миникарта схемы')}">
                        <span class="material-symbols-outlined text-[15px]">map</span>
                    </button>
                </div>
            </div>
        `;
        topActions.querySelector('.add-root-node-btn').onclick = () => this.addRootNode();
        topActions.querySelector('.add-tier-top-btn').onclick = () => this.addLevel();
        const topClearBtn = topActions.querySelector('.clear-all-top-btn');
        if (topClearBtn) {
            topClearBtn.onclick = () => this.handleClearAll();
        }
        this.wireZoomControls(topActions);
        shell.appendChild(topActions);

        const viewport = document.createElement('div');
        viewport.className = 'se-hierarchy-viewport';
        viewport.id = 'se-hierarchy-viewport';
        if (prevScrollLeft || prevScrollTop) {
            viewport.scrollLeft = prevScrollLeft;
            viewport.scrollTop = prevScrollTop;
        }

        const stage = document.createElement('div');
        stage.className = 'se-hierarchy-stage';
        stage.id = 'se-hierarchy-stage';
        stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.canvasZoom})`;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'se-hierarchy-svg');
        svg.setAttribute('aria-hidden', 'true');
        stage.appendChild(svg);

        const grid = document.createElement('div');
        grid.className = 'se-hierarchy-grid';
        const colWidth = layout.totalCols <= 2 ? '380px' : (layout.totalCols === 3 ? '320px' : '280px');
        grid.style.gridTemplateColumns = `230px repeat(${layout.totalCols}, ${colWidth})`;

        const totalTiers = this.levels.length;

        // 1. Clean open-air corner spacer at (1, 1)
        const cornerSpacer = document.createElement('div');
        cornerSpacer.className = 'se-grid-corner-spacer';
        cornerSpacer.style.gridColumn = '1 / 2';
        cornerSpacer.style.gridRow = '1';
        grid.appendChild(cornerSpacer);

        // 2. Render Column Lanes and Column Headers at gridRow: 1
        layout.rootNodes.forEach((rootNode, rIdx) => {
            const colStart = layout.colStartByNodeId ? layout.colStartByNodeId.get(rootNode.nodeId) : (rIdx + 1);
            const colSpan = layout.spanByNodeId ? layout.spanByNodeId.get(rootNode.nodeId) : 1;
            const colAccentVar = `var(--col-accent-${rIdx % 6})`;

            // Vertical background lane spanning across all tiers
            const colLane = document.createElement('div');
            colLane.className = 'se-col-lane';
            colLane.style.gridColumn = `${colStart + 1} / span ${colSpan}`;
            colLane.style.gridRow = `1 / ${totalTiers + 2}`;
            colLane.style.setProperty('--col-accent', colAccentVar);
            colLane.setAttribute('data-col-idx', String(rIdx));
            grid.appendChild(colLane);

            // Column Header at gridRow: 1
            const colHeaderWrap = document.createElement('div');
            colHeaderWrap.className = 'se-col-header-wrapper';
            colHeaderWrap.style.gridColumn = `${colStart + 1} / span ${colSpan}`;
            colHeaderWrap.style.gridRow = '1';
            if (rIdx === 0) {
                colHeaderWrap.setAttribute('data-onboarding-target', 'sequence-hierarchy-first-column');
            }

            const romanNum = this.toRoman(rIdx + 1);
            const canMoveLeft = rIdx > 0;
            const canMoveRight = rIdx < layout.rootNodes.length - 1;
            const canDeleteCol = layout.rootNodes.length > 1;

            colHeaderWrap.innerHTML = `
                <div class="se-col-header-cell" data-root-id="${rootNode.nodeId}" data-col-idx="${rIdx}" style="--col-accent: ${colAccentVar};">
                    <div class="se-col-header-top">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="se-col-badge">${romanNum} ${wt('se.col_badge_label', 'КОЛОНКА')}</span>
                        </div>
                        <div class="se-col-actions flex items-center gap-0.5">
                            <button type="button" class="move-col-left icon-button-muted icon-button-muted--xs" ${canMoveLeft ? '' : 'disabled'} data-i18n-title="se.move_col_left" title="${wt('se.move_col_left', 'Переместить колонку влево')}"><span class="material-symbols-outlined text-[14px]">chevron_left</span></button>
                            <button type="button" class="move-col-right icon-button-muted icon-button-muted--xs" ${canMoveRight ? '' : 'disabled'} data-i18n-title="se.move_col_right" title="${wt('se.move_col_right', 'Переместить колонку вправо')}"><span class="material-symbols-outlined text-[14px]">chevron_right</span></button>
                            <button type="button" class="delete-col icon-button-muted icon-button-muted--xs text-error-text hover:text-error" ${canDeleteCol ? '' : 'disabled'} data-i18n-title="se.delete_col_title" title="${wt('se.delete_col_title', 'Удалить колонку')}"><span class="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    </div>
                    <div class="se-col-header-body">
                        <input type="text" class="col-title-input w-full" value="${this.escapeHtml(rootNode.columnTitle || '')}" data-i18n-placeholder="se.col_name_placeholder" placeholder="${wt('se.col_name_placeholder', 'Название колонки...')}" />
                    </div>
                </div>
            `;

            const colTitleInput = colHeaderWrap.querySelector('.col-title-input');
            colTitleInput.oninput = (e) => {
                const val = e.target.value;
                rootNode.columnTitle = val;
                this.markUnsaved();
                this.updateClearAllButtonState();
                this.scheduleHistorySave(400);

                const cleanVal = val.trim();
                grid.querySelectorAll(`.se-node-col-tag[data-col-idx="${rIdx}"]`).forEach(tag => {
                    tag.title = cleanVal ? `${romanNum} · ${cleanVal}` : `${romanNum} ${wt('se.col_badge_label', 'КОЛОНКА')}`;
                    let nameEl = tag.querySelector('.se-node-col-name');
                    let sepEl = tag.querySelector('.se-node-col-sep');
                    if (cleanVal) {
                        if (nameEl) {
                            nameEl.textContent = cleanVal;
                        } else {
                            sepEl = document.createElement('span');
                            sepEl.className = 'se-node-col-sep';
                            sepEl.textContent = '·';
                            nameEl = document.createElement('span');
                            nameEl.className = 'se-node-col-name';
                            nameEl.textContent = cleanVal;
                            tag.appendChild(sepEl);
                            tag.appendChild(nameEl);
                        }
                    } else {
                        if (nameEl) nameEl.remove();
                        if (sepEl) sepEl.remove();
                    }
                });
            };
            colTitleInput.onblur = () => {
                this.flushPendingHistorySave();
            };
            colTitleInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    colTitleInput.blur();
                }
            };

            const leftBtn = colHeaderWrap.querySelector('.move-col-left');
            if (leftBtn) leftBtn.onclick = () => this.moveNodeSibling(rootNode.nodeId, -1);
            const rightBtn = colHeaderWrap.querySelector('.move-col-right');
            if (rightBtn) rightBtn.onclick = () => this.moveNodeSibling(rootNode.nodeId, 1);
            const delBtn = colHeaderWrap.querySelector('.delete-col');
            if (delBtn) delBtn.onclick = () => this.deleteNode(rootNode.nodeId);

            grid.appendChild(colHeaderWrap);
        });

        // 3. Horizontal Levels & Cards (shifted down by 1 row: gridRow = lIndex + 2)
        this.levels.forEach((level, lIndex) => {
            const tierRow = lIndex + 2;

            const tierBand = document.createElement('div');
            tierBand.className = 'se-tier-band';
            tierBand.style.gridColumn = '1 / -1';
            tierBand.style.gridRow = `${tierRow}`;
            if (this.colorDifferentiation) {
                tierBand.setAttribute('data-color-tint', String(lIndex % 6));
            }
            grid.appendChild(tierBand);

            const tierCell = document.createElement('div');
            tierCell.className = 'se-tier-cell';
            tierCell.style.gridColumn = '1 / 2';
            tierCell.style.gridRow = `${tierRow}`;
            if (lIndex === 0) {
                tierCell.setAttribute('data-onboarding-target', 'sequence-hierarchy-first-tier');
            }
            if (this.colorDifferentiation) {
                tierCell.setAttribute('data-color-tint', String(lIndex % 6));
            }

            const isSingleTier = totalTiers <= 1;
            const isFirstTier = lIndex === 0;
            const isLastTier = lIndex === totalTiers - 1;

            tierCell.innerHTML = `
                <div class="se-tier-cell-header">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="se-tier-badge sequence-level-index">${lIndex + 1}</span>
                        <span class="text-[11px] font-bold uppercase tracking-wider text-text-muted truncate" data-i18n="se.tier_badge_prefix">${wt('se.tier_badge_prefix', 'Уровень')}</span>
                    </div>
                    <div class="se-tier-actions flex items-center gap-0.5">
                        <button type="button" class="move-up icon-button-muted icon-button-muted--xs" ${isFirstTier || isSingleTier ? 'disabled' : ''} title="${wt('se.k009', 'Переместить вверх')}"><span class="material-symbols-outlined text-[14px]">arrow_upward</span></button>
                        <button type="button" class="move-down icon-button-muted icon-button-muted--xs" ${isLastTier || isSingleTier ? 'disabled' : ''} title="${wt('se.k010', 'Переместить вниз')}"><span class="material-symbols-outlined text-[14px]">arrow_downward</span></button>
                        <button type="button" class="delete-level icon-button-muted icon-button-muted--xs text-error-text hover:text-error" ${isSingleTier ? 'disabled' : ''} title="${wt('se.k011', 'Удалить уровень')}"><span class="material-symbols-outlined text-[14px]">close</span></button>
                    </div>
                </div>
                <div class="se-tier-body flex-1 flex flex-col justify-start w-full">
                    <textarea class="level-title-input se-tier-input w-full" rows="2" data-i18n-placeholder="se.tier_name_placeholder" placeholder="${wt('se.tier_name_placeholder', 'Название уровня / параметра...')}"></textarea>
                </div>
            `;

            const tierInput = tierCell.querySelector('.level-title-input');
            tierInput.value = level.title || '';
            tierInput.oninput = (e) => {
                this.levels[lIndex].title = e.target.value;
                this.markUnsaved();
                this.updateClearAllButtonState();
                this.scheduleHistorySave(400);
            };
            tierInput.onblur = () => {
                this.flushPendingHistorySave();
            };
            tierInput.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    tierInput.blur();
                }
            };

            tierCell.querySelector('.move-up').onclick = () => this.moveLevel(lIndex, -1);
            tierCell.querySelector('.move-down').onclick = () => this.moveLevel(lIndex, 1);
            tierCell.querySelector('.delete-level').onclick = () => this.deleteLevel(lIndex);

            grid.appendChild(tierCell);

            const tierNodes = layout.nodesByTier[lIndex] || [];
            tierNodes.forEach((nodeLayout, nIdx) => {
                const nodeCell = document.createElement('div');
                nodeCell.className = 'se-node-cell';
                nodeCell.style.gridColumn = `${nodeLayout.colStart + 1} / span ${nodeLayout.colSpan}`;
                nodeCell.style.gridRow = `${tierRow}`;

                const nodeCard = this.createHierarchyNodeCard(nodeLayout, lIndex, nIdx, layout);
                nodeCell.appendChild(nodeCard);
                grid.appendChild(nodeCell);
            });
        });

        stage.appendChild(grid);
        viewport.appendChild(stage);
        shell.appendChild(viewport);

        const minimap = document.createElement('div');
        minimap.className = `se-minimap${this.minimapVisible ? '' : ' is-hidden'}`;
        minimap.id = 'se-hierarchy-minimap';
        minimap.innerHTML = `
            <svg class="se-minimap-svg" preserveAspectRatio="xMidYMid meet"></svg>
            <div class="se-minimap-viewport"></div>
        `;
        minimap.addEventListener('click', (e) => {
            const rect = minimap.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            viewport.scrollTo({
                left: Math.max(0, relX * viewport.scrollWidth - viewport.clientWidth / 2),
                top: Math.max(0, relY * viewport.scrollHeight - viewport.clientHeight / 2),
                behavior: 'smooth',
            });
        });
        shell.appendChild(minimap);

        const isTyping = (el) => {
            if (!el) return false;
            const tag = el.tagName ? el.tagName.toUpperCase() : '';
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
        };

        const onKeyDown = (e) => {
            if (e.code === 'Space') {
                if (isTyping(document.activeElement) || isTyping(e.target)) {
                    return; // Normal typing inside input/textarea
                }
                if (!this.isSpacePressed) {
                    this.isSpacePressed = true;
                    viewport.classList.add('is-hand-tool');
                }
                e.preventDefault();
            }
        };

        const onKeyUp = (e) => {
            if (e.code === 'Space') {
                this.isSpacePressed = false;
                viewport.classList.remove('is-hand-tool');
                if (this.isPanning && this.panMouseButton === 0) {
                    this.isPanning = false;
                    viewport.classList.remove('is-panning');
                }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        viewport.addEventListener('mousedown', (e) => {
            const isMMB = e.button === 1;
            const isSpaceLMB = e.button === 0 && this.isSpacePressed;

            if (isMMB || isSpaceLMB) {
                e.preventDefault();
                this.isPanning = true;
                this.panMouseButton = e.button;
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;
                this.panOriginX = this.panX;
                this.panOriginY = this.panY;
                viewport.classList.add('is-panning');
            }
        });

        const onMouseMove = (e) => {
            if (!this.isPanning) return;
            const dx = e.clientX - this.panStartX;
            const dy = e.clientY - this.panStartY;
            this.panX = this.panOriginX + dx;
            this.panY = this.panOriginY + dy;
            this.applyCanvasTransform();
        };

        const onMouseUp = (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                viewport.classList.remove('is-panning');
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        this._hierarchyWindowCleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        viewport.addEventListener('scroll', () => {
            this._savedScrollLeft = viewport.scrollLeft;
            this._savedScrollTop = viewport.scrollTop;
            this.updateHierarchyMinimap();
        }, { passive: true });
        viewport.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                this.setCanvasZoom(this.canvasZoom + delta, 0.40, 1.50);
            }
        }, { passive: false });

        container.appendChild(shell);

        const refreshGeometry = () => {
            container.querySelectorAll('.block-title-input').forEach((field) => {
                this.autoResizeField(field);
            });
            this.renderHierarchyConnectors();
            this.updateHierarchyMinimap();

            if (!this._initialHierarchyFitted && this.levels && this.levels.length >= 3) {
                this._initialHierarchyFitted = true;
                this.fitToViewport();
            }

            if (this._lastCreatedNodeId) {
                const targetNodeId = this._lastCreatedNodeId;
                this._lastCreatedNodeId = null;
                const newCard = stage.querySelector(`.se-node-card[data-node-id="${targetNodeId}"]`);
                if (newCard) {
                    const input = newCard.querySelector('.block-title-input');
                    if (input) {
                        input.focus();
                    }
                }
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(refreshGeometry);
        } else {
            setTimeout(refreshGeometry, 0);
        }
    }

    createHierarchyNodeCard(nodeLayout, lIndex, nIdx, layout) {
        const { node, hasChildren, siblingIndex, siblingCount } = nodeLayout;
        const card = document.createElement('div');
        const isLeafGroup = !hasChildren && node.items.length > 1;
        const isNewNode = this._lastCreatedNodeId && this._lastCreatedNodeId === node.nodeId;
        const rootIdx = nodeLayout.rootIndex ?? 0;
        const rootNode = layout.rootNodes[rootIdx] || null;
        const rootColTitle = (rootNode && rootNode.columnTitle ? rootNode.columnTitle : '').trim();
        const romanNum = this.toRoman(rootIdx + 1);

        card.className = `se-node-card sequence-block-card${isLeafGroup ? ' is-leaf-group' : ''}${isNewNode ? ' is-new-node' : ''}`;
        card.setAttribute('data-node-id', node.nodeId);
        card.setAttribute('data-level-id', node.levelId);
        card.setAttribute('data-col-idx', String(rootIdx));
        card.style.setProperty('--col-accent', `var(--col-accent-${rootIdx % 6})`);
        if (node.parentId) {
            card.setAttribute('data-parent-id', node.parentId);
        }
        if (this.colorDifferentiation) {
            card.setAttribute('data-color-tint', String(lIndex % 6));
        }
        if (lIndex === 0 && nIdx === 0) {
            card.setAttribute('data-onboarding-target', 'sequence-hierarchy-first-node');
        }

        card.addEventListener('pointerenter', () => {
            const svgEl = document.querySelector('.se-hierarchy-svg');
            if (!svgEl) return;
            svgEl.querySelectorAll(`.se-connector-path[data-parent-id="${node.nodeId}"], .se-connector-path[data-child-id="${node.nodeId}"]`)
                .forEach((p) => p.classList.add('is-active'));
        });
        card.addEventListener('pointerleave', () => {
            const svgEl = document.querySelector('.se-hierarchy-svg');
            if (!svgEl) return;
            svgEl.querySelectorAll('.se-connector-path.is-active')
                .forEach((p) => p.classList.remove('is-active'));
        });

        const badgeLabel = `${lIndex + 1}.${nIdx + 1}`;
        const canMoveLeft = siblingIndex > 0;
        const canMoveRight = siblingIndex < siblingCount - 1;
        const canDeleteNode = !(lIndex === 0 && layout.rootNodes.length <= 1);

        const groupBadgeHtml = isLeafGroup
            ? `<span class="se-node-group-badge"><span class="material-symbols-outlined text-[12px]">layers</span>${wt('se.leaf_group_badge', 'Группа ({count})').replace('{count}', node.items.length)}</span>`
            : '';

        const colTagHtml = `
            <span class="se-node-col-tag" data-col-idx="${rootIdx}" title="${rootColTitle ? `${romanNum} · ${this.escapeHtml(rootColTitle)}` : `${romanNum} ${wt('se.col_badge_label', 'КОЛОНКА')}`}">
                <span class="se-node-col-dot">•</span>
                <span class="se-node-col-roman">${romanNum}</span>
                ${rootColTitle ? `<span class="se-node-col-sep">·</span><span class="se-node-col-name">${this.escapeHtml(rootColTitle)}</span>` : ''}
            </span>
        `;

        card.title = node.items.map(i => i.label).filter(Boolean).join('\n');
        card.innerHTML = `
            <div class="se-node-header">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="se-node-badge">${badgeLabel}</span>
                    ${colTagHtml}
                    ${groupBadgeHtml}
                </div>
                <div class="se-node-header-actions flex items-center gap-0.5">
                    <button type="button" class="move-node-left icon-button-muted icon-button-muted--xs" ${canMoveLeft ? '' : 'disabled'} title="${wt('se.k016', 'Влево')}"><span class="material-symbols-outlined text-[14px]">chevron_left</span></button>
                    <button type="button" class="move-node-right icon-button-muted icon-button-muted--xs" ${canMoveRight ? '' : 'disabled'} title="${wt('se.k017', 'Вправо')}"><span class="material-symbols-outlined text-[14px]">chevron_right</span></button>
                    <button type="button" class="delete-node icon-button-muted icon-button-muted--xs text-error-text hover:text-error" ${canDeleteNode ? '' : 'disabled'} title="${wt('se.delete_node_title', 'Удалить узел и дочерние ветки')}"><span class="material-symbols-outlined text-[14px]">close</span></button>
                </div>
            </div>
            <div class="se-node-items-list"></div>
            <div class="se-node-footer">
                <div class="se-node-footer-group flex items-center min-w-0">
                    ${!hasChildren ? `
                        <button type="button" class="add-node-item-btn se-node-action-btn" data-i18n-title="se.btn_add_group_item_title" title="${wt('se.btn_add_group_item_title', 'Добавить ещё один элемент в этот листовой контейнер (Enter)')}">
                            <span class="material-symbols-outlined">playlist_add</span>
                            <span data-i18n="se.btn_add_group_item">${wt('se.btn_add_group_item', '+ Элемент')}</span>
                        </button>
                    ` : ''}
                </div>
                <div class="se-node-footer-branch flex items-center gap-1 shrink-0">
                    <button type="button" class="add-child-node-btn se-node-action-btn se-node-action-btn--primary" data-i18n-title="se.btn_add_child_branch_title" title="${wt('se.btn_add_child_branch_title', 'Создать блок на следующем уровне (Alt+↓)')}">
                        <span class="material-symbols-outlined">south</span>
                        <span data-i18n="se.btn_add_child_branch">${wt('se.btn_add_child_branch', '+ Уровень')}</span>
                    </button>
                    <button type="button" class="add-sibling-node-btn se-node-action-btn" data-i18n-title="se.btn_add_sibling_branch_title" title="${wt('se.btn_add_sibling_branch_title', 'Создать блок в следующей колонке')}">
                        <span class="material-symbols-outlined">east</span>
                        <span data-i18n="se.btn_add_sibling_branch">${wt('se.btn_add_sibling_branch', '+ Колонка')}</span>
                    </button>
                </div>
            </div>
        `;

        card.querySelector('.move-node-left').onclick = () => this.moveNodeSibling(node.nodeId, -1);
        card.querySelector('.move-node-right').onclick = () => this.moveNodeSibling(node.nodeId, 1);
        card.querySelector('.delete-node').onclick = () => this.deleteNode(node.nodeId);

        const addItemBtn = card.querySelector('.add-node-item-btn');
        if (addItemBtn) {
            addItemBtn.onclick = () => this.addItemToNode(node.nodeId);
        }
        card.querySelector('.add-child-node-btn').onclick = () => this.addChildNode(node.nodeId);
        card.querySelector('.add-sibling-node-btn').onclick = () => this.addSiblingNode(node.nodeId);

        const itemsList = card.querySelector('.se-node-items-list');
        node.items.forEach((item, iIdx) => {
            const itemRow = document.createElement('div');
            itemRow.className = 'se-node-item-row';
            const showDeleteItem = node.items.length > 1;

            itemRow.innerHTML = `
                <textarea class="block-title-input sequence-block-title se-node-item-input"
                          rows="2" data-min-height="36" data-i18n-placeholder="se.node_item_placeholder" placeholder="${wt('se.node_item_placeholder', 'Текст элемента или признака...')}"></textarea>
                ${showDeleteItem ? `
                    <button type="button" class="delete-node-item" title="${wt('se.k014', 'Удалить элемент')}">
                        <span class="material-symbols-outlined text-[13px]">close</span>
                    </button>
                ` : ''}
            `;

            const textarea = itemRow.querySelector('.block-title-input');
            textarea.value = item.label || '';
            textarea.title = item.label || '';
            textarea.oninput = (e) => {
                item.label = e.target.value;
                textarea.title = e.target.value;
                card.title = node.items.map(i => i.label).filter(Boolean).join('\n');
                this.syncLevelsFromNodes();
                this.markUnsaved();
                this.updateClearAllButtonState();
                this.autoResizeField(e.target);
                this.renderHierarchyConnectors();
                this.scheduleHistorySave(400);
            };
            textarea.onblur = () => {
                this.flushPendingHistorySave();
            };

            const delItemBtn = itemRow.querySelector('.delete-node-item');
            if (delItemBtn) {
                delItemBtn.onclick = () => this.deleteItemFromNode(node.nodeId, iIdx);
            }

            itemsList.appendChild(itemRow);
        });

        return card;
    }

    renderHierarchyConnectors() {
        const stage = document.querySelector('#se-hierarchy-stage');
        const svg = stage?.querySelector('.se-hierarchy-svg');
        if (!stage || !svg) return;

        const stageRect = stage.getBoundingClientRect();
        const scale = this.canvasZoom || 1;
        const stageW = Math.max(stage.scrollWidth, Math.round(stageRect.width / scale) || 600);
        const stageH = Math.max(stage.scrollHeight, Math.round(stageRect.height / scale) || 400);

        svg.setAttribute('viewBox', `0 0 ${stageW} ${stageH}`);
        svg.setAttribute('width', String(stageW));
        svg.setAttribute('height', String(stageH));
        svg.innerHTML = '';

        const cardById = new Map();
        stage.querySelectorAll('.se-node-card[data-node-id]').forEach((el) => {
            cardById.set(el.getAttribute('data-node-id'), el);
        });

        cardById.forEach((childEl) => {
            const parentId = childEl.getAttribute('data-parent-id');
            if (!parentId || !cardById.has(parentId)) return;
            const parentEl = cardById.get(parentId);
            const pRect = parentEl.getBoundingClientRect();
            const cRect = childEl.getBoundingClientRect();
            if (!pRect.width && !cRect.width) return;

            const px = (pRect.left - stageRect.left + pRect.width / 2) / scale;
            const py = (pRect.bottom - stageRect.top) / scale;
            const cx = (cRect.left - stageRect.left + cRect.width / 2) / scale;
            const cy = (cRect.top - stageRect.top) / scale;
            const midY = py + (cy - py) * 0.5;

            const colIdx = childEl.getAttribute('data-col-idx') || '0';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'se-connector-path');
            path.setAttribute('data-parent-id', parentId);
            path.setAttribute('data-child-id', childEl.getAttribute('data-node-id'));
            path.setAttribute('data-col-idx', colIdx);
            path.style.setProperty('--col-accent', `var(--col-accent-${parseInt(colIdx, 10) % 6})`);
            path.setAttribute('d', `M ${px} ${py} C ${px} ${midY}, ${cx} ${midY}, ${cx} ${cy}`);
            svg.appendChild(path);
        });

        // Draw vertical stems from column headers down to root nodes
        stage.querySelectorAll('.se-col-header-cell[data-root-id]').forEach((headerEl) => {
            const rootId = headerEl.getAttribute('data-root-id');
            const colIdx = headerEl.getAttribute('data-col-idx') || '0';
            const rootCard = cardById.get(rootId);
            if (!rootCard) return;

            const hRect = headerEl.getBoundingClientRect();
            const rRect = rootCard.getBoundingClientRect();
            if (!hRect.width && !rRect.width) return;

            const hx = (hRect.left - stageRect.left + hRect.width / 2) / scale;
            const hy = (hRect.bottom - stageRect.top) / scale;
            const rx = (rRect.left - stageRect.left + rRect.width / 2) / scale;
            const ry = (rRect.top - stageRect.top) / scale;
            const midY = hy + (ry - hy) * 0.5;

            const colStem = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            colStem.setAttribute('class', 'se-connector-path se-connector-path--col-stem');
            colStem.setAttribute('data-col-root-id', rootId);
            colStem.setAttribute('data-col-idx', colIdx);
            colStem.style.setProperty('--col-accent', `var(--col-accent-${parseInt(colIdx, 10) % 6})`);
            colStem.setAttribute('d', `M ${hx} ${hy} C ${hx} ${midY}, ${rx} ${midY}, ${rx} ${ry}`);
            svg.appendChild(colStem);
        });
    }

    updateHierarchyMinimap() {
        const minimap = document.querySelector('#se-hierarchy-minimap');
        const viewport = document.querySelector('#se-hierarchy-viewport');
        const stage = document.querySelector('#se-hierarchy-stage');
        if (!minimap || !viewport || !stage) return;

        const fits = viewport.scrollWidth <= viewport.clientWidth + 2 && viewport.scrollHeight <= viewport.clientHeight + 2;
        const hidden = !this.minimapVisible || fits;
        minimap.classList.toggle('is-hidden', hidden);
        const mapBtn = document.querySelector('#se-minimap-toggle');
        if (mapBtn) {
            mapBtn.classList.toggle('is-active', this.minimapVisible && !fits);
        }
        if (hidden) return;

        const miniSvg = minimap.querySelector('.se-minimap-svg');
        const miniVp = minimap.querySelector('.se-minimap-viewport');
        if (!miniSvg || !miniVp) return;

        const scale = this.canvasZoom || 1;
        const stageRect = stage.getBoundingClientRect();
        const totalW = Math.max(viewport.scrollWidth, stage.scrollWidth, 600);
        const totalH = Math.max(viewport.scrollHeight, stage.scrollHeight, 360);

        miniSvg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
        miniSvg.innerHTML = '';

        // Draw connectors in minimap
        const editorCardMap = new Map();
        stage.querySelectorAll('.se-node-card[data-node-id]').forEach((el) => {
            editorCardMap.set(el.getAttribute('data-node-id'), el);
        });
        (this.nodes || []).forEach((node) => {
            const nodeId = node.nodeId || node.node_id;
            const parentId = node.parentId || node.parent_id;
            if (!parentId || !editorCardMap.has(nodeId) || !editorCardMap.has(parentId)) return;
            const pEl = editorCardMap.get(parentId);
            const cEl = editorCardMap.get(nodeId);
            const pR = pEl.getBoundingClientRect();
            const cR = cEl.getBoundingClientRect();
            const px = Math.max(0, (pR.left - stageRect.left + pR.width / 2) / scale);
            const py = Math.max(0, (pR.top - stageRect.top + pR.height) / scale);
            const cx = Math.max(0, (cR.left - stageRect.left + cR.width / 2) / scale);
            const cy = Math.max(0, (cR.top - stageRect.top) / scale);
            const midY = py + (cy - py) / 2;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'rgba(37, 99, 235, 0.4)');
            path.setAttribute('stroke-width', '2');
            miniSvg.appendChild(path);
        });

        stage.querySelectorAll('.se-node-card[data-node-id]').forEach((el) => {
            const r = el.getBoundingClientRect();
            const x = Math.max(0, (r.left - stageRect.left) / scale);
            const y = Math.max(0, (r.top - stageRect.top) / scale);
            const w = Math.max(40, r.width / scale || 160);
            const h = Math.max(24, r.height / scale || 64);
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', String(x));
            rect.setAttribute('y', String(y));
            rect.setAttribute('width', String(w));
            rect.setAttribute('height', String(h));
            rect.setAttribute('rx', '8');
            rect.setAttribute('fill', 'rgba(37, 99, 235, 0.22)');
            rect.setAttribute('stroke', 'rgba(37, 99, 235, 0.55)');
            rect.setAttribute('stroke-width', '2');
            miniSvg.appendChild(rect);
        });

        const vpW = Math.min(1, (viewport.clientWidth || totalW) / totalW);
        const vpH = Math.min(1, (viewport.clientHeight || totalH) / totalH);
        const vpLeft = Math.min(1 - vpW, (viewport.scrollLeft || 0) / totalW);
        const vpTop = Math.min(1 - vpH, (viewport.scrollTop || 0) / totalH);

        miniVp.style.left = `${(vpLeft * 100).toFixed(1)}%`;
        miniVp.style.top = `${(vpTop * 100).toFixed(1)}%`;
        miniVp.style.width = `${Math.max(15, vpW * 100).toFixed(1)}%`;
        miniVp.style.height = `${Math.max(15, vpH * 100).toFixed(1)}%`;
    }

    applyCanvasTransform() {
        const stage = document.querySelector('#se-hierarchy-stage');
        if (!stage) return;
        stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.canvasZoom})`;
        const resetBtn = document.querySelector('#se-zoom-reset');
        if (resetBtn) {
            resetBtn.textContent = `${Math.round(this.canvasZoom * 100)}%`;
        }
        const zoomIn = document.querySelector('#se-zoom-in');
        const zoomOut = document.querySelector('#se-zoom-out');
        if (zoomIn) zoomIn.disabled = this.canvasZoom >= 1.50;
        if (zoomOut) zoomOut.disabled = this.canvasZoom <= 0.40;

        const slider = document.querySelector('#se-zoom-slider');
        if (slider && Number(slider.value) !== Math.round(this.canvasZoom * 100)) {
            slider.value = Math.round(this.canvasZoom * 100);
        }

        this.renderHierarchyConnectors();
        this.updateHierarchyMinimap();
    }

    setCanvasZoom(nextZoom, minZoom = 0.40, maxZoom = 1.50, { recenter = false } = {}) {
        const clamped = Math.max(minZoom, Math.min(maxZoom, Math.round(nextZoom * 100) / 100));
        const viewport = document.querySelector('#se-hierarchy-viewport');
        const grid = document.querySelector('.se-hierarchy-grid');
        if (viewport && grid) {
            const naturalW = grid.offsetWidth || grid.scrollWidth;
            const naturalH = grid.offsetHeight || grid.scrollHeight;
            const oldZoom = this.canvasZoom || 1;

            if (recenter || this.panX === undefined || this.panY === undefined) {
                const gridOffsetLeft = grid.offsetLeft || 0;
                const gridCenterStageX = gridOffsetLeft + naturalW / 2;
                const scaledW = naturalW * clamped;
                const scaledH = naturalH * clamped;
                const centerPanX = Math.round(viewport.clientWidth / 2 - gridCenterStageX * clamped);
                // Strict Frustum Invariant: Column 1 and Tier headers must NEVER clip off-screen (min 24px)
                this.panX = scaledW <= viewport.clientWidth ? Math.max(24, centerPanX) : 24;
                this.panY = Math.max(20, Math.round((viewport.clientHeight - scaledH) / 2));
            } else {
                // Keep the viewport center point stable during zoom
                const viewCenterX = viewport.clientWidth / 2;
                const viewCenterY = viewport.clientHeight / 2;
                const stageX = (viewCenterX - this.panX) / oldZoom;
                const stageY = (viewCenterY - this.panY) / oldZoom;
                this.panX = Math.round(viewCenterX - stageX * clamped);
                this.panY = Math.round(viewCenterY - stageY * clamped);
            }
        }
        this.canvasZoom = clamped;
        this.applyCanvasTransform();
    }

    captureHierarchyNodeRects() {
        const rects = new Map();
        const stage = document.querySelector('#se-hierarchy-stage') || document.querySelector('.se-hierarchy-grid');
        if (!stage) return rects;
        stage.querySelectorAll('.se-node-card[data-node-id]').forEach((card) => {
            const nodeId = card.getAttribute('data-node-id');
            if (nodeId && !card.classList.contains('se-node-card--exiting')) {
                rects.set(nodeId, card.getBoundingClientRect());
            }
        });
        stage.querySelectorAll('.se-col-header-cell[data-root-id]').forEach((colHeader) => {
            const rootId = colHeader.getAttribute('data-root-id');
            if (rootId) {
                rects.set(`col-${rootId}`, colHeader.getBoundingClientRect());
            }
        });
        return rects;
    }

    animateHierarchyFLIP(prevRects, durationMs = 220) {
        if (!prevRects || !(prevRects instanceof Map) || prevRects.size === 0) return;
        const stage = document.querySelector('#se-hierarchy-stage') || document.querySelector('.se-hierarchy-grid');
        if (!stage) return;

        let hasDisplacedCards = false;
        stage.querySelectorAll('.se-node-card[data-node-id]').forEach((card) => {
            const nodeId = card.getAttribute('data-node-id');
            const prevRect = prevRects.get(nodeId);
            if (!prevRect || card.classList.contains('is-new-node') || card.classList.contains('se-node-card--exiting')) return;

            const newRect = card.getBoundingClientRect();
            const dx = Math.round(prevRect.left - newRect.left);
            const dy = Math.round(prevRect.top - newRect.top);

            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                hasDisplacedCards = true;
                card.style.transform = `translate(${dx}px, ${dy}px)`;
                card.style.transition = 'none';

                // Force reflow
                void card.offsetHeight;

                card.style.transition = `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
                card.style.transform = 'translate(0px, 0px)';

                const onEnd = () => {
                    card.style.transform = '';
                    card.style.transition = '';
                    card.removeEventListener('transitionend', onEnd);
                };
                card.addEventListener('transitionend', onEnd);
            }
        });

        stage.querySelectorAll('.se-col-header-cell[data-root-id]').forEach((colHeader) => {
            const rootId = colHeader.getAttribute('data-root-id');
            const prevRect = prevRects.get(`col-${rootId}`);
            if (!prevRect) return;

            const newRect = colHeader.getBoundingClientRect();
            const dx = Math.round(prevRect.left - newRect.left);
            const dy = Math.round(prevRect.top - newRect.top);

            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                hasDisplacedCards = true;
                colHeader.style.transform = `translate(${dx}px, ${dy}px)`;
                colHeader.style.transition = 'none';

                void colHeader.offsetHeight;

                colHeader.style.transition = `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
                colHeader.style.transform = 'translate(0px, 0px)';

                const onEnd = () => {
                    colHeader.style.transform = '';
                    colHeader.style.transition = '';
                    colHeader.removeEventListener('transitionend', onEnd);
                };
                colHeader.addEventListener('transitionend', onEnd);
            }
        });

        if (hasDisplacedCards) {
            this.trackConnectorAnimation(durationMs + 20);
        }
    }

    syncNodeCardGroupBadge(card, node) {
        if (!card || !node || !Array.isArray(node.items)) return;
        const hasChildren = this.nodes.some(n => n.parentId === node.nodeId);
        const isLeafGroup = !hasChildren && node.items.length > 1;
        card.classList.toggle('is-leaf-group', isLeafGroup);

        const badgeContainer = card.querySelector('.se-node-header .flex.items-center');
        if (!badgeContainer) return;

        let badge = badgeContainer.querySelector('.se-node-group-badge');
        if (isLeafGroup) {
            const badgeText = wt('se.leaf_group_badge', 'Группа ({count})').replace('{count}', node.items.length);
            if (badge) {
                badge.innerHTML = `<span class="material-symbols-outlined text-[12px]">layers</span>${badgeText}`;
            } else {
                badge = document.createElement('span');
                badge.className = 'se-node-group-badge';
                badge.innerHTML = `<span class="material-symbols-outlined text-[12px]">layers</span>${badgeText}`;
                badgeContainer.appendChild(badge);
            }
        } else if (badge) {
            badge.remove();
        }
    }

    clearCardErrorIfResolved(card) {
        if (!card) return;
        const hasErrors = card.querySelector('.se-field--error') !== null;
        if (!hasErrors) {
            card.classList.remove('se-node-card--error', 'se-shake');
        }
    }

    trackConnectorAnimation(durationMs = 220) {
        if (typeof window === 'undefined' || !window.requestAnimationFrame) {
            this.renderHierarchyConnectors();
            this.updateHierarchyMinimap();
            return;
        }
        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const step = (now) => {
            this.renderHierarchyConnectors();
            this.updateHierarchyMinimap();
            const current = (typeof performance !== 'undefined' && performance.now) ? now : Date.now();
            if (current - start < durationMs) {
                window.requestAnimationFrame(step);
            } else {
                this.renderHierarchyConnectors();
                this.updateHierarchyMinimap();
            }
        };
        window.requestAnimationFrame(step);
    }

    fitToViewport() {
        const viewport = document.querySelector('#se-hierarchy-viewport');
        const grid = document.querySelector('.se-hierarchy-grid');
        const stage = document.querySelector('#se-hierarchy-stage');
        if (!viewport || !grid || !stage) return;

        stage.style.transform = 'translate(0px, 0px) scale(1)';
        const naturalW = grid.offsetWidth || grid.scrollWidth;
        const naturalH = grid.offsetHeight || grid.scrollHeight;
        const availableW = Math.max(300, viewport.clientWidth - 48);
        const availableH = Math.max(200, viewport.clientHeight - 48);

        const scaleX = naturalW > 0 ? availableW / naturalW : 1.0;
        const scaleY = naturalH > 0 ? availableH / naturalH : 1.0;
        // Strict 2D First-Fold Invariant: never exceed vertical or horizontal viewport bounds
        let fitScale = Math.min(1.0, scaleX, scaleY);
        fitScale = Math.max(0.55, fitScale);

        const scaledW = naturalW * fitScale;
        const scaledH = naturalH * fitScale;
        this.panX = Math.max(24, Math.round((viewport.clientWidth - scaledW) / 2));
        this.panY = Math.max(20, Math.round((viewport.clientHeight - scaledH) / 2));

        this.setCanvasZoom(fitScale, 0.40, 1.50, { recenter: true });
        if (typeof viewport.scrollTo === 'function') {
            viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        } else {
            viewport.scrollLeft = 0;
            viewport.scrollTop = 0;
        }
    }

    wireZoomControls(container) {
        if (!container) return;
        const zoomIn = container.querySelector('#se-zoom-in');
        if (zoomIn) zoomIn.onclick = () => this.setCanvasZoom(this.canvasZoom + 0.1, 0.40, 1.50);

        const zoomOut = container.querySelector('#se-zoom-out');
        if (zoomOut) zoomOut.onclick = () => this.setCanvasZoom(this.canvasZoom - 0.1, 0.40, 1.50);

        const zoomSlider = container.querySelector('#se-zoom-slider');
        if (zoomSlider) {
            zoomSlider.oninput = (e) => {
                const val = Number(e.target.value) / 100;
                this.setCanvasZoom(val, 0.40, 1.50);
            };
        }

        const zoomReset = container.querySelector('#se-zoom-reset');
        if (zoomReset) {
            zoomReset.onclick = () => {
                this.fitToViewport();
            };
        }

        const zoomFit = container.querySelector('#se-zoom-fit');
        if (zoomFit) zoomFit.onclick = () => this.fitToViewport();

        const minimapToggle = container.querySelector('#se-minimap-toggle');
        if (minimapToggle) {
            minimapToggle.classList.toggle('is-active', this.minimapVisible);
            minimapToggle.onclick = () => {
                this.minimapVisible = !this.minimapVisible;
                minimapToggle.classList.toggle('is-active', this.minimapVisible);
                this.updateHierarchyMinimap();
            };
        }
    }

    applyQuickTable(colsInput, rowsInput) {
        const hasExistingContent = (Array.isArray(this.nodes) && this.nodes.some(n => n.items && n.items.some(it => String(it.label || '').trim()))) ||
                                   (Array.isArray(this.levels) && this.levels.some(l => String(l.title || '').trim()));
        if (hasExistingContent && typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const confirmed = window.confirm(wt('se.confirm_replace_structure', 'Внимание: существующие узлы будут заменены новой сеткой. Продолжить?'));
            if (!confirmed) return;
        }

        const cols = Math.max(2, Math.min(8, parseInt(colsInput, 10) || 2));
        const rows = Math.max(1, Math.min(10, parseInt(rowsInput, 10) || 3));

        this.checkpointHistoryBeforeMutation();
        this.displayMode = 'hierarchy';

        const newLevels = [];
        for (let r = 0; r < rows; r++) {
            const existingLevel = this.levels[r];
            newLevels.push({
                levelId: existingLevel?.levelId || this.generateId('level'),
                title: existingLevel?.title || '',
                items: [],
            });
        }
        this.levels = newLevels;

        const newNodes = [];
        let prevRowNodes = [];
        for (let r = 0; r < rows; r++) {
            const currentRowNodes = [];
            const levelId = this.levels[r].levelId;
            for (let c = 0; c < cols; c++) {
                const parentId = r === 0 ? null : prevRowNodes[c].nodeId;
                const node = this.createEmptyNode({
                    levelId,
                    parentId,
                    items: [this.createEmptyItem('')],
                });
                newNodes.push(node);
                currentRowNodes.push(node);
            }
            prevRowNodes = currentRowNodes;
        }
        this.nodes = newNodes;
        this.syncLevelsFromNodes();

        const popover = document.querySelector('#quick-table-popover');
        if (popover) popover.classList.add('hidden');

        this.updateDisplayModeControls(false);
        this.updateSettingsHelpText();
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory();
        this.showToast(
            wt('se.quick_table_created_toast', 'Создана сравнительная сетка {cols} × {rows}')
                .replace('{cols}', cols)
                .replace('{rows}', rows),
            'info'
        );
    }

    addRootNode() {
        this.ensureDefaultStructure();
        this.checkpointHistoryBeforeMutation();
        const prevRects = this.captureHierarchyNodeRects();

        let prevParentId = null;
        let rootNodeId = null;
        for (let lIdx = 0; lIdx < this.levels.length; lIdx++) {
            const level = this.levels[lIdx];
            const node = this.createEmptyNode({
                levelId: level.levelId,
                parentId: prevParentId,
                items: [this.createEmptyItem('')],
            });
            if (lIdx === 0) {
                rootNodeId = node.nodeId;
                this._lastCreatedNodeId = node.nodeId;
            }
            this.nodes.push(node);
            prevParentId = node.nodeId;
        }

        this.syncLevelsFromNodes();
        this.renderLevels();
        this.animateHierarchyFLIP(prevRects);
        this.markUnsaved();
        this.saveStateToHistory();

        if (rootNodeId && typeof document !== 'undefined') {
            const colHeader = document.querySelector(`.se-col-header-cell[data-root-id="${rootNodeId}"]`);
            if (colHeader) {
                const titleInput = colHeader.querySelector('.col-title-input');
                if (titleInput && typeof titleInput.focus === 'function') {
                    titleInput.focus();
                }
                if (typeof colHeader.scrollIntoView === 'function') {
                    colHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
            }
        }
    }

    addSiblingNode(nodeId) {
        const target = this.nodes.find(n => n.nodeId === nodeId);
        if (!target) return;
        this.checkpointHistoryBeforeMutation();
        const prevRects = this.captureHierarchyNodeRects();
        const sibling = this.createEmptyNode({
            levelId: target.levelId,
            parentId: target.parentId || null,
            items: [this.createEmptyItem('')],
        });
        this._lastCreatedNodeId = sibling.nodeId;
        const targetIdx = this.nodes.indexOf(target);
        this.nodes.splice(targetIdx + 1, 0, sibling);
        this.syncLevelsFromNodes();
        this.renderLevels();
        this.animateHierarchyFLIP(prevRects);
        this.markUnsaved();
        this.saveStateToHistory();
    }

    addChildNode(parentNodeId) {
        const parentNode = this.nodes.find(n => n.nodeId === parentNodeId);
        if (!parentNode) return;
        this.checkpointHistoryBeforeMutation();
        const prevRects = this.captureHierarchyNodeRects();

        let splitHappened = false;
        // Variant B rule: if parentNode had multiple items in a leaf container-group,
        // automatically split items[1..K-1] into sibling nodes on the same tier before branching!
        if (Array.isArray(parentNode.items) && parentNode.items.length > 1) {
            const extraItems = parentNode.items.splice(1);
            const parentIdx = this.nodes.indexOf(parentNode);
            extraItems.forEach((extraItem, offset) => {
                const splitSibling = this.createEmptyNode({
                    levelId: parentNode.levelId,
                    parentId: parentNode.parentId || null,
                    items: [extraItem],
                });
                this.nodes.splice(parentIdx + 1 + offset, 0, splitSibling);
            });
            splitHappened = true;
        }

        const currentTierIdx = this.levels.findIndex(l => l.levelId === parentNode.levelId);
        const nextTierIdx = currentTierIdx >= 0 ? currentTierIdx + 1 : this.levels.length;
        let nextLevel = this.levels[nextTierIdx];
        if (!nextLevel) {
            nextLevel = this.createEmptyLevel('');
            this.levels.push(nextLevel);
        }

        const childNode = this.createEmptyNode({
            levelId: nextLevel.levelId,
            parentId: parentNode.nodeId,
            items: [this.createEmptyItem('')],
        });
        this._lastCreatedNodeId = childNode.nodeId;
        this.nodes.push(childNode);
        this.syncLevelsFromNodes();
        this.renderLevels();
        this.animateHierarchyFLIP(prevRects);
        this.markUnsaved();
        this.saveStateToHistory();

        if (splitHappened) {
            this.showToast(
                wt('se.node_split_notice', 'Группа разделена на отдельные узлы для ветвления'),
                'info'
            );
        }
    }

    addItemToNode(nodeId) {
        const node = this.nodes.find(n => n.nodeId === nodeId);
        if (!node) return;
        const hasChildren = this.nodes.some(n => n.parentId === nodeId);
        if (hasChildren) {
            this.showToast(
                wt('se.btn_add_group_item_title', 'Добавить элемент в конечную группу-список этого узла'),
                'warning'
            );
            return;
        }
        this.checkpointHistoryBeforeMutation();
        const newItem = this.createEmptyItem('');
        node.items.push(newItem);
        const itemIdx = node.items.length - 1;

        const card = document.querySelector(`.se-node-card[data-node-id="${nodeId}"]`);
        const itemsList = card?.querySelector('.se-node-items-list');

        if (itemsList && card) {
            // If card previously had 1 item, it didn't have a delete button. Add it now.
            if (node.items.length === 2) {
                const firstRow = itemsList.children[0];
                if (firstRow && !firstRow.querySelector('.delete-node-item')) {
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'delete-node-item';
                    delBtn.title = wt('se.k014', 'Удалить элемент');
                    delBtn.innerHTML = '<span class="material-symbols-outlined text-[13px]">close</span>';
                    delBtn.onclick = () => this.deleteItemFromNode(node.nodeId, 0);
                    firstRow.appendChild(delBtn);
                }
            }

            const itemRow = document.createElement('div');
            itemRow.className = 'se-node-item-row se-node-item-row--entering';
            itemRow.innerHTML = `
                <textarea class="block-title-input sequence-block-title se-node-item-input"
                          rows="2" data-min-height="36" data-i18n-placeholder="se.node_item_placeholder" placeholder="${wt('se.node_item_placeholder', 'Текст элемента или признака...')}"></textarea>
                <button type="button" class="delete-node-item" title="${wt('se.k014', 'Удалить элемент')}">
                    <span class="material-symbols-outlined text-[13px]">close</span>
                </button>
            `;

            const textarea = itemRow.querySelector('.block-title-input');
            textarea.value = newItem.label || '';
            textarea.title = newItem.label || '';
            textarea.oninput = (e) => {
                newItem.label = e.target.value;
                textarea.title = e.target.value;
                card.title = node.items.map(i => i.label).filter(Boolean).join('\n');
                this.syncLevelsFromNodes();
                this.markUnsaved();
                this.updateClearAllButtonState();
                this.autoResizeField(e.target);
                this.renderHierarchyConnectors();
                this.scheduleHistorySave(400);
            };
            textarea.onblur = () => {
                this.flushPendingHistorySave();
            };

            const delItemBtn = itemRow.querySelector('.delete-node-item');
            if (delItemBtn) {
                delItemBtn.onclick = () => this.deleteItemFromNode(node.nodeId, itemIdx);
            }

            itemsList.appendChild(itemRow);
            this.autoResizeField(textarea);
            textarea.focus();

            this.syncNodeCardGroupBadge(card, node);
            this.trackConnectorAnimation(220);

            setTimeout(() => {
                itemRow.classList.remove('se-node-item-row--entering');
            }, 220);

            this.syncLevelsFromNodes();
            this.markUnsaved();
            this.saveStateToHistory();
        } else {
            this.syncLevelsFromNodes();
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory();
        }
    }

    deleteItemFromNode(nodeId, itemIndex) {
        const node = this.nodes.find(n => n.nodeId === nodeId);
        if (!node || !Array.isArray(node.items)) return;
        if (node.items.length <= 1) {
            this.showToast(wt('se.k023', 'В уровне должен быть хотя бы один шаг.'), 'error');
            return;
        }

        const card = document.querySelector(`.se-node-card[data-node-id="${nodeId}"]`);
        const itemsList = card?.querySelector('.se-node-items-list');
        const targetRow = itemsList?.children[itemIndex];

        if (targetRow && card) {
            this.checkpointHistoryBeforeMutation();
            node.items.splice(itemIndex, 1);
            this.syncLevelsFromNodes();
            this.markUnsaved();
            this.saveStateToHistory();
            targetRow.classList.add('se-node-item-row--exiting');
            this.trackConnectorAnimation(200);

            setTimeout(() => {
                targetRow.remove();
                if (itemsList) {
                    Array.from(itemsList.children).forEach((row, newIdx) => {
                        const delBtn = row.querySelector('.delete-node-item');
                        if (delBtn) {
                            delBtn.onclick = () => this.deleteItemFromNode(node.nodeId, newIdx);
                        }
                    });
                    if (node.items.length === 1) {
                        const remainingDelBtn = itemsList.querySelector('.delete-node-item');
                        if (remainingDelBtn) remainingDelBtn.remove();
                    }
                }
                card.title = node.items.map(i => i.label).filter(Boolean).join('\n');
                this.syncNodeCardGroupBadge(card, node);
                this.clearCardErrorIfResolved(card);
                this.renderHierarchyConnectors();
                this.updateHierarchyMinimap();
            }, 180);
        } else {
            this.checkpointHistoryBeforeMutation();
            node.items.splice(itemIndex, 1);
            this.syncLevelsFromNodes();
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory();
        }
    }

    deleteNode(nodeId) {
        const target = this.nodes.find(n => n.nodeId === nodeId);
        if (!target) return;
        const roots = this.nodes.filter(n => !n.parentId);
        if (!target.parentId && roots.length <= 1) {
            this.showToast(wt('se.k018', 'Должен остаться минимум один уровень.'), 'error');
            return;
        }

        this.checkpointHistoryBeforeMutation();
        const toDelete = new Set([nodeId]);
        let added = true;
        while (added) {
            added = false;
            this.nodes.forEach((n) => {
                if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.nodeId)) {
                    toDelete.add(n.nodeId);
                    added = true;
                }
            });
        }

        const cardsToDelete = Array.from(toDelete).map(id => document.querySelector(`.se-node-card[data-node-id="${id}"]`)).filter(Boolean);
        const executeDelete = () => {
            const prevRects = this.captureHierarchyNodeRects();
            this.nodes = this.nodes.filter(n => !toDelete.has(n.nodeId));
            while (this.levels.length > 1) {
                const lastLevel = this.levels[this.levels.length - 1];
                const hasNodesOnLast = this.nodes.some(n => n.levelId === lastLevel.levelId);
                if (!hasNodesOnLast) {
                    this.levels.pop();
                } else {
                    break;
                }
            }
            this.syncLevelsFromNodes();
            this.renderLevels();
            this.animateHierarchyFLIP(prevRects);
            this.markUnsaved();
            this.saveStateToHistory();
        };

        if (cardsToDelete.length > 0) {
            cardsToDelete.forEach(c => c.classList.add('se-node-card--exiting'));
            this.trackConnectorAnimation(180);
            setTimeout(executeDelete, 180);
        } else {
            executeDelete();
        }
    }

    moveNodeSibling(nodeId, direction) {
        const target = this.nodes.find(n => n.nodeId === nodeId);
        if (!target) return;
        const siblings = this.nodes.filter(
            n => n.levelId === target.levelId && (n.parentId || null) === (target.parentId || null)
        );
        const sIdx = siblings.indexOf(target);
        const swapIdx = sIdx + direction;
        if (sIdx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;

        const other = siblings[swapIdx];
        const idxA = this.nodes.indexOf(target);
        const idxB = this.nodes.indexOf(other);
        if (idxA < 0 || idxB < 0) return;

        this.checkpointHistoryBeforeMutation();
        this.nodes[idxA] = other;
        this.nodes[idxB] = target;
        this.syncLevelsFromNodes();
        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory();
    }

    expandBlock(card) {
        if (!card) return;
        this.collapseAllBlocks();
        card.classList.add('is-expanded');

        // Elevate parent wrapper and level in CSS stacking context
        const wrapper = card.closest('.sequence-block-wrapper');
        if (wrapper) wrapper.classList.add('has-expanded-card');
        const level = card.closest('.sequence-level-card');
        if (level) level.classList.add('has-expanded-card');

        const textarea = card.querySelector('.block-title-input');
        if (textarea) {
            this.autoResizeField(textarea);
        }
        const expandTrigger = card.querySelector('.sequence-block-expand-trigger');
        if (expandTrigger) expandTrigger.style.setProperty('display', 'none', 'important');
        const headerCollapse = card.querySelector('.sequence-block-header-collapse-btn');
        if (headerCollapse) headerCollapse.style.setProperty('display', 'inline-flex', 'important');

        // Smart in-view auto-scroll
        const ensureInView = () => {
            if (!card.classList.contains('is-expanded')) return;
            const cardRect = card.getBoundingClientRect();
            const viewportH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 800;
            if (cardRect.bottom > viewportH - 24) {
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => setTimeout(ensureInView, 60));
        } else {
            setTimeout(ensureInView, 60);
        }
    }

    collapseBlock(card) {
        if (!card) return;
        card.classList.remove('is-expanded');
        const wrapper = card.closest('.sequence-block-wrapper');
        if (wrapper) wrapper.classList.remove('has-expanded-card');
        const level = card.closest('.sequence-level-card');
        if (level) level.classList.remove('has-expanded-card');

        const textarea = card.querySelector('.block-title-input');
        if (textarea) {
            textarea.style.height = '';
            textarea.style.maxHeight = '';
            textarea.style.overflowY = 'hidden';
        }
        const headerCollapse = card.querySelector('.sequence-block-header-collapse-btn');
        if (headerCollapse) headerCollapse.style.setProperty('display', 'none', 'important');
        this.updateBlockExpandTrigger(card);
    }

    collapseAllBlocks() {
        document.querySelectorAll('.sequence-block-card.is-expanded').forEach(card => {
            this.collapseBlock(card);
        });
        document.querySelectorAll('.sequence-block-wrapper.has-expanded-card').forEach(el => {
            el.classList.remove('has-expanded-card');
        });
        document.querySelectorAll('.sequence-level-card.has-expanded-card').forEach(el => {
            el.classList.remove('has-expanded-card');
        });
    }

    updateBlockExpandTrigger(card) {
        if (!card) return;
        const textarea = card.querySelector('.block-title-input');
        const expandTrigger = card.querySelector('.sequence-block-expand-trigger');
        if (!textarea || !expandTrigger) return;
        const text = String(textarea.value || '');
        const isLong = text.includes('\n') || text.length > 45;
        expandTrigger.style.setProperty('display', (isLong && !card.classList.contains('is-expanded')) ? 'inline-flex' : 'none', 'important');
    }

    createBlockElement(item, lIndex, iIndex) {
        const wrapper = document.createElement('div');
        wrapper.className = 'sequence-block-wrapper relative min-w-0';

        const div = document.createElement('div');
        div.className = 'sequence-block-card rounded-xl p-3 flex flex-col justify-between gap-1.5 relative transition-all border border-border-subtle bg-surface-1 hover:border-primary/40 group/block min-w-0 shadow-xs hover:shadow-sm cursor-pointer';
        if (lIndex === 0 && iIndex === 0) {
            div.setAttribute('data-onboarding-target', 'sequence-first-step');
            wrapper.setAttribute('data-onboarding-target', 'sequence-first-step-wrapper');
        } else if (lIndex === 0 && iIndex === 1) {
            div.setAttribute('data-onboarding-target', 'sequence-second-step');
        }
        if (item.id) {
            div.style.viewTransitionName = `block-${item.id}`;
        }

        const isMultiLevel = this.levels.length > 1;
        const stepNumber = isMultiLevel ? `${lIndex + 1}.${iIndex + 1}` : `#${iIndex + 1}`;
        const totalItemsInLevel = this.levels[lIndex].items.length;
        const isFirstItem = iIndex === 0;
        const isLastItem = iIndex === totalItemsInLevel - 1;
        const isSingleItem = totalItemsInLevel <= 1;

        div.innerHTML = `
            <div class="sequence-block-header flex items-center justify-between gap-1.5 w-full select-none">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="sequence-block-badge text-[11px] font-bold text-text-muted bg-surface-2/90 px-1.5 py-0.5 rounded border border-border-subtle/80 leading-none shrink-0">
                        ${stepNumber}
                    </span>
                    <button type="button" class="sequence-block-expand-trigger inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-primary bg-primary-lighter/60 hover:bg-primary-lighter border border-primary/25 rounded cursor-pointer transition-colors" data-i18n-title="seq_editor.expand_step_full" data-i18n-aria="seq_editor.expand_step_full" title="${wt('seq_editor.expand_step_full', 'Развернуть шаг')}" aria-label="${wt('seq_editor.expand_step_full', 'Развернуть шаг')}">
                        <span class="material-symbols-outlined text-[13px]">expand_more</span>
                        <span data-i18n="seq_editor.expand_step">${wt('seq_editor.expand_step', 'Развернуть')}</span>
                    </button>
                    <button type="button" class="sequence-block-header-collapse-btn hidden inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-primary bg-primary-lighter/60 hover:bg-primary-lighter border border-primary/25 rounded cursor-pointer transition-colors" data-i18n-title="seq_editor.collapse_step_full" data-i18n-aria="seq_editor.collapse_step_full" title="${wt('seq_editor.collapse_step_full', 'Свернуть шаг')}" aria-label="${wt('seq_editor.collapse_step_full', 'Свернуть шаг')}">
                        <span class="material-symbols-outlined text-[13px]">expand_less</span>
                        <span data-i18n="seq_editor.collapse_step">${wt('seq_editor.collapse_step', 'Свернуть')}</span>
                    </button>
                </div>
                <button class="delete-block sequence-block-delete icon-button-muted icon-button-muted--xs border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error shrink-0" data-i18n-title="se.k014" title="${wt('se.k014', 'Удалить элемент')}" aria-label="${wt('se.k014', 'Удалить элемент')} ${stepNumber}">
                    <span class="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>
            <textarea class="block-title-input sequence-block-title w-full flex-1 text-sm font-medium border border-transparent bg-transparent hover:border-border-subtle hover:bg-surface-2/30 focus:border-primary focus:bg-surface-1 focus:ring-2 focus:ring-primary/20 rounded-md text-text-main placeholder-text-disabled resize-none transition-colors py-1 px-1.5 text-left leading-snug break-words outline-none" 
                   rows="2" data-i18n-placeholder="se.k015" placeholder="${wt('se.k015', 'Опишите элемент...')}"></textarea>
            <div class="sequence-block-actions grid grid-cols-2 gap-2 text-[11px] font-bold select-none">
                <button class="move-left sequence-block-move-btn btn-secondary btn-secondary--compact inline-flex items-center justify-center gap-1 w-full min-w-0 rounded-md transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none" ${isFirstItem || isSingleItem ? 'disabled' : ''} aria-label="${wt('se.k016', 'Влево')} (${stepNumber})">
                    <span class="material-symbols-outlined text-[16px]">chevron_left</span>
                    <span data-i18n="se.k016">${wt('se.k016', 'Влево')}</span>
                </button>
                <button class="move-right sequence-block-move-btn btn-secondary btn-secondary--compact inline-flex items-center justify-center gap-1 w-full min-w-0 rounded-md transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none" ${isLastItem || isSingleItem ? 'disabled' : ''} aria-label="${wt('se.k017', 'Вправо')} (${stepNumber})">
                    <span data-i18n="se.k017">${wt('se.k017', 'Вправо')}</span>
                    <span class="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
            </div>
            <button type="button" class="sequence-block-collapse-btn btn-secondary btn-secondary--compact w-full items-center justify-center gap-1 py-1 px-2 text-xs font-bold text-primary hover:text-primary-dark bg-primary-lighter/50 hover:bg-primary-lighter border border-primary/30 rounded-md transition-all cursor-pointer shadow-xs select-none" data-i18n-title="seq_editor.collapse_step" title="${wt('seq_editor.collapse_step', 'Свернуть')}">
                <span class="material-symbols-outlined text-[16px]">expand_less</span>
                <span data-i18n="seq_editor.collapse_step">${wt('seq_editor.collapse_step', 'Свернуть')}</span>
            </button>
        `;

        const titleField = div.querySelector('.block-title-input');
        const expandTrigger = div.querySelector('.sequence-block-expand-trigger');
        const headerCollapse = div.querySelector('.sequence-block-header-collapse-btn');
        const collapseBtn = div.querySelector('.sequence-block-collapse-btn');

        if (titleField) {
            if (lIndex === 0 && iIndex === 0) {
                titleField.setAttribute('data-onboarding-target', 'sequence-first-step-text');
            }
            titleField.value = item.label || '';
            this.updateBlockExpandTrigger(div);

            titleField.addEventListener('focus', () => {
                const text = String(titleField.value || '');
                if ((text.includes('\n') || text.length > 45) && !div.classList.contains('is-expanded')) {
                    this.expandBlock(div);
                }
            });

            titleField.oninput = (e) => {
                this.levels[lIndex].items[iIndex].label = e.target.value;
                this.markUnsaved();
                this.updateClearAllButtonState();
                this.updateBlockExpandTrigger(div);
                if (div.classList.contains('is-expanded')) {
                    this.autoResizeField(e.target);
                }
                this.scheduleHistorySave(400);
            };
            titleField.onblur = () => {
                this.flushPendingHistorySave();
            };
        }

        if (expandTrigger) {
            expandTrigger.onclick = (e) => {
                e.stopPropagation();
                this.expandBlock(div);
                if (titleField) titleField.focus();
            };
        }

        if (headerCollapse) {
            headerCollapse.onclick = (e) => {
                e.stopPropagation();
                this.collapseBlock(div);
            };
        }

        if (collapseBtn) {
            collapseBtn.onclick = (e) => {
                e.stopPropagation();
                this.collapseBlock(div);
            };
        }

        div.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const text = String(titleField ? titleField.value : '');
            if ((text.includes('\n') || text.length > 45) && !div.classList.contains('is-expanded')) {
                this.expandBlock(div);
            }
            if (titleField && document.activeElement !== titleField) {
                titleField.focus();
            }
        });

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

        wrapper.appendChild(div);
        return wrapper;
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
        const removedLevel = this.levels[index];
        const prevLevel = index > 0 ? this.levels[index - 1] : null;
        this.levels.splice(index, 1);

        if (this.displayMode === 'hierarchy' && removedLevel) {
            const removedIds = new Set(
                this.nodes.filter(n => n.levelId === removedLevel.levelId).map(n => n.nodeId)
            );
            const parentByRemovedId = new Map(
                this.nodes.filter(n => n.levelId === removedLevel.levelId).map(n => [n.nodeId, n.parentId || null])
            );
            this.nodes = this.nodes.filter(n => n.levelId !== removedLevel.levelId);
            this.nodes.forEach((n) => {
                if (n.parentId && removedIds.has(n.parentId)) {
                    n.parentId = prevLevel ? (parentByRemovedId.get(n.parentId) || null) : null;
                }
            });
            this.syncLevelsFromNodes();
        }

        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory(); // Save state for undo/redo
        this.showToast(wt('se.k022', 'Уровень удалён. При необходимости нажмите Ctrl+Z, чтобы вернуть его.'), 'info');
    }

    addLevel() {
        this.checkpointHistoryBeforeMutation();
        const prevLastLevel = this.levels[this.levels.length - 1];
        const newLevel = this.createEmptyLevel();
        this.levels.push(newLevel);

        if (this.displayMode === 'hierarchy' && prevLastLevel) {
            const prevTierNodes = this.nodes.filter(n => n.levelId === prevLastLevel.levelId);
            if (prevTierNodes.length) {
                prevTierNodes.forEach((parentNode) => {
                    this.nodes.push(this.createEmptyNode({
                        levelId: newLevel.levelId,
                        parentId: parentNode.nodeId,
                        items: [this.createEmptyItem('')],
                    }));
                });
            } else {
                this.nodes.push(this.createEmptyNode({
                    levelId: newLevel.levelId,
                    parentId: null,
                    items: [this.createEmptyItem('')],
                }));
            }
            this.syncLevelsFromNodes();
        }

        this.renderLevels();
        this.markUnsaved();
        this.saveStateToHistory(); // Save state for undo/redo
    }

    refreshLinearLevelBlockStates(targetLevelCard, lIndex) {
        if (!targetLevelCard) return;
        const level = this.levels[lIndex];
        if (!level || !Array.isArray(level.items)) return;

        const blocksContainer = targetLevelCard.querySelector('.sequence-level-blocks') || targetLevelCard.querySelector('[class*="grid"]');
        if (!blocksContainer) return;

        const blockWrappers = Array.from(blocksContainer.querySelectorAll('.sequence-block-wrapper'));
        const totalItemsInLevel = blockWrappers.length;
        const isMultiLevel = this.levels.length > 1;

        blockWrappers.forEach((wrapper, iIndex) => {
            const stepNumber = isMultiLevel ? `${lIndex + 1}.${iIndex + 1}` : `#${iIndex + 1}`;
            const isFirstItem = iIndex === 0;
            const isLastItem = iIndex === totalItemsInLevel - 1;
            const isSingleItem = totalItemsInLevel <= 1;

            const badge = wrapper.querySelector('.sequence-block-badge');
            if (badge) {
                badge.textContent = stepNumber;
            }

            const deleteBtn = wrapper.querySelector('.delete-block');
            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteBlock(lIndex, iIndex);
                };
            }

            const moveLeftBtn = wrapper.querySelector('.move-left');
            if (moveLeftBtn) {
                moveLeftBtn.disabled = isFirstItem || isSingleItem;
                moveLeftBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.moveBlock(lIndex, iIndex, -1);
                };
            }

            const moveRightBtn = wrapper.querySelector('.move-right');
            if (moveRightBtn) {
                moveRightBtn.disabled = isLastItem || isSingleItem;
                moveRightBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.moveBlock(lIndex, iIndex, 1);
                };
            }
        });
    }

    addBlock(lIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        this.checkpointHistoryBeforeMutation();
        const newItem = this.createEmptyItem();
        level.items.push(newItem);

        const levelCards = document.querySelectorAll('.sequence-level-card');
        const targetLevelCard = levelCards[lIndex];
        const blocksContainer = targetLevelCard?.querySelector('.sequence-level-blocks') || targetLevelCard?.querySelector('[class*="grid"]');

        if (blocksContainer) {
            const iIndex = level.items.length - 1;
            const blockWrapper = this.createBlockElement(newItem, lIndex, iIndex);
            blockWrapper.classList.add('sequence-block-wrapper--entering');

            const addBtn = blocksContainer.querySelector('.sequence-add-block-btn');
            if (addBtn) {
                blocksContainer.insertBefore(blockWrapper, addBtn);
            } else {
                blocksContainer.appendChild(blockWrapper);
            }

            this.refreshLinearLevelBlockStates(targetLevelCard, lIndex);

            const textarea = blockWrapper.querySelector('textarea');
            if (textarea) {
                this.autoResizeField(textarea);
                textarea.focus();
            }

            setTimeout(() => {
                blockWrapper.classList.remove('sequence-block-wrapper--entering');
            }, 220);

            this.markUnsaved();
            this.saveStateToHistory();
            this.updateClearAllButtonState();
        } else {
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory();
        }
    }

    deleteBlock(lIndex, iIndex) {
        const level = this.levels[lIndex];
        if (!level) return;
        if (level.items.length <= 1) {
            this.showToast(wt('se.k023', 'В уровне должен быть хотя бы один шаг.'), 'error');
            return;
        }

        const levelCards = document.querySelectorAll('.sequence-level-card');
        const targetLevelCard = levelCards[lIndex];
        const blocksContainer = targetLevelCard?.querySelector('.sequence-level-blocks') || targetLevelCard?.querySelector('[class*="grid"]');
        const targetBlock = blocksContainer?.children[iIndex];

        if (targetBlock) {
            this.checkpointHistoryBeforeMutation();
            level.items.splice(iIndex, 1);
            this.markUnsaved();
            this.saveStateToHistory();
            targetBlock.classList.add('sequence-block-wrapper--exiting');

            setTimeout(() => {
                this.renderLevels();
                this.showToast(wt('se.k024', 'Шаг удалён. При необходимости нажмите Ctrl+Z, чтобы вернуть его.'), 'info');
            }, 180);
        } else {
            this.checkpointHistoryBeforeMutation();
            level.items.splice(iIndex, 1);
            this.renderLevels();
            this.markUnsaved();
            this.saveStateToHistory();
            this.showToast(wt('se.k024', 'Шаг удалён. При необходимости нажмите Ctrl+Z, чтобы вернуть его.'), 'info');
        }
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

    updateLocalizedControlAttributes() {
        const backBtn = document.querySelector('#back-to-dashboard');
        if (backBtn) {
            backBtn.title = wt('se.k025', 'Вернуться к редактору заданий');
            backBtn.setAttribute('aria-label', backBtn.title);
        }

        const clearAllBtn = document.querySelector('#clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.title = wt('se.k026', 'Очистить всю текущую структуру');
        }

        const addLevelBtn = document.querySelector('#add-level-btn');
        if (addLevelBtn) {
            addLevelBtn.title = wt('se.k031', 'Добавить новый уровень');
        }

        const saveBtn = document.querySelector('#save-task-btn');
        if (saveBtn) {
            saveBtn.title = wt('se.k032', 'Сохранить задание');
        }
    }

    onLocaleChanged() {
        if ((this.sequenceOnboardingPreview || this.sequenceOnboardingDemoActive) && !this.sequenceOnboardingFinished) {
            this.applySequenceOnboardingPreviewState();
            this.updateLocalizedControlAttributes();
            return;
        }

        this.updateTaskTitleDisplay();
        this.updateDisplayModeControls(true);
        this.updateSettingsHelpText();
        this.updateLocalizedControlAttributes();
        this.updateSaveStatus();

        const levelsContainer = document.querySelector('#levels-container');
        const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
        const isEditingInLevels = Boolean(levelsContainer && activeEl && levelsContainer.contains(activeEl));
        if (!isEditingInLevels) {
            this.renderLevels();
        } else if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.updateDOM === 'function') {
            window.i18n.updateDOM();
        }
    }

    toggleSidebar(forceState) {
        const sidebar = document.querySelector('#sequence-sidebar');
        const toggleBtn = document.querySelector('#toggle-settings-sidebar-btn');
        if (!sidebar) return;
        const isCurrentlyCollapsed = sidebar.classList.contains('is-collapsed');
        const shouldCollapse = typeof forceState === 'boolean' ? !forceState : !isCurrentlyCollapsed;

        sidebar.classList.toggle('is-collapsed', shouldCollapse);
        if (toggleBtn) {
            toggleBtn.classList.toggle('bg-primary/10', !shouldCollapse);
            toggleBtn.classList.toggle('text-primary', !shouldCollapse);
            toggleBtn.classList.toggle('border-primary/30', !shouldCollapse);
            toggleBtn.setAttribute('aria-expanded', String(!shouldCollapse));
        }

        setTimeout(() => {
            if (this.displayMode === 'hierarchy') {
                this.fitToViewport();
                this.renderHierarchyConnectors();
                this.updateHierarchyMinimap();
            }
        }, 240);
    }

    setupEventListeners() {
        const titleDisplay = document.querySelector('#task-title-display');
        if (titleDisplay) {
            this.setupHeaderRenameTrigger(titleDisplay, {
                onSuccess: () => this.updateTaskTitleDisplay()
            });
            this.updateTaskTitleDisplay();
        }

        this.updateLocalizedControlAttributes();

        const backBtn = document.querySelector('#back-to-dashboard');
        if (backBtn) {
            backBtn.onclick = () => this.goBack();
        }

        const tabLinear = document.querySelector('#mode-tab-linear');
        if (tabLinear) {
            tabLinear.onclick = () => void this.setDisplayMode('linear');
        }

        const tabHierarchy = document.querySelector('#mode-tab-hierarchy');
        if (tabHierarchy) {
            tabHierarchy.onclick = () => void this.setDisplayMode('hierarchy');
        }

        const quickTableBtn = document.querySelector('#quick-table-btn');
        const quickTablePopover = document.querySelector('#quick-table-popover');
        if (quickTableBtn && quickTablePopover) {
            quickTableBtn.onclick = (e) => {
                e.stopPropagation();
                quickTablePopover.classList.toggle('hidden');
            };
        }

        const quickTableApplyBtn = document.querySelector('#quick-table-apply-btn');
        if (quickTableApplyBtn) {
            quickTableApplyBtn.onclick = () => {
                const colsInput = document.querySelector('#quick-table-cols-input');
                const rowsInput = document.querySelector('#quick-table-rows-input');
                this.applyQuickTable(colsInput ? colsInput.value : 2, rowsInput ? rowsInput.value : 3);
            };
        }

        this.wireZoomControls(document);

        const clearAllBtn = document.querySelector('#clear-all-btn');
        if (clearAllBtn) {
            clearAllBtn.onclick = () => this.handleClearAll();
        }

        const addLevelBtn = document.querySelector('#add-level-btn');
        if (addLevelBtn) {
            addLevelBtn.onclick = () => this.addLevel();
        }

        const saveBtn = document.querySelector('#save-task-btn');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveTask();
        }

        const toggleSidebarBtn = document.querySelector('#toggle-settings-sidebar-btn');
        if (toggleSidebarBtn) {
            toggleSidebarBtn.onclick = () => this.toggleSidebar();
        }

        const collapseSidebarBtn = document.querySelector('#collapse-sidebar-btn');
        if (collapseSidebarBtn) {
            collapseSidebarBtn.onclick = () => this.toggleSidebar(false);
        }

        const railBtn = document.querySelector('#sequence-sidebar-rail-btn');
        if (railBtn) {
            railBtn.onclick = () => this.toggleSidebar(true);
        }

        const promptArea = document.querySelector('#prompt-textarea');
        if (promptArea) {
            promptArea.addEventListener('input', () => {
                this.adjustPromptHeight(promptArea);
                this.syncPromptAccordion(false);
                this.markUnsaved();
                this.scheduleHistorySave(400);
            });
            promptArea.addEventListener('blur', () => {
                this.flushPendingHistorySave();
            });
        }

        const promptToggle = document.querySelector('#se-prompt-toggle');
        if (promptToggle) {
            promptToggle.addEventListener('click', (e) => {
                if (e.target.closest('#prompt-textarea')) return;
                const accordion = document.querySelector('#se-prompt-accordion');
                const isCurrentlyCollapsed = accordion?.classList.contains('is-collapsed');
                this.syncPromptAccordion(!isCurrentlyCollapsed);
            });
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

        document.addEventListener('pointerdown', (e) => {
            if (quickTablePopover && !quickTablePopover.classList.contains('hidden')) {
                if (!e.target.closest('#quick-table-popover') && !e.target.closest('#quick-table-btn')) {
                    quickTablePopover.classList.add('hidden');
                }
            }
            if (e.target.closest('.sequence-block-card.is-expanded')) return;
            this.collapseAllBlocks();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (quickTablePopover) quickTablePopover.classList.add('hidden');
                this.collapseAllBlocks();
            }
        });

        window.addEventListener('resize', () => {
            this.updateDisplayModeControls(true);
        });
    }

    buildStructure() {
        if (this.displayMode === 'hierarchy' && Array.isArray(this.nodes) && this.nodes.length) {
            this.syncLevelsFromNodes();
        }
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

        const normalizedNodes = (this.displayMode === 'hierarchy' && Array.isArray(this.nodes))
            ? this.nodes.map((node) => {
                const nodeId = node.nodeId || this.generateId('node');
                node.nodeId = nodeId;
                const blocks = (node.items || []).map((item) => {
                    const itemId = item.id || this.generateId('elem');
                    item.id = itemId;
                    return itemId;
                });
                const normNode = {
                    node_id: nodeId,
                    level_id: node.levelId,
                    parent_id: node.parentId || null,
                    blocks,
                };
                const colTitle = (node.columnTitle || '').trim();
                if (colTitle) {
                    normNode.column_title = colTitle;
                }
                return normNode;
            })
            : [];

        return {
            elements: Array.from(elementMap.values()),
            levels: normalizedLevels,
            legacySequence,
            nodes: normalizedNodes,
        };
    }

    clearValidationErrors() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.se-field--error').forEach(el => {
            el.classList.remove('se-field--error');
        });
        document.querySelectorAll('.se-node-card--error, .se-shake').forEach(el => {
            el.classList.remove('se-node-card--error', 'se-shake');
        });
    }

    /**
     * Validate task before saving (BaseEditor abstract method)
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        this.clearValidationErrors();

        if (this.displayMode === 'hierarchy' && Array.isArray(this.nodes) && this.nodes.length) {
            this.syncLevelsFromNodes();
        }
        const humanName = this.getTaskDisplayName().trim();
        const promptArea = document.querySelector('#prompt-textarea');
        const prompt = promptArea ? promptArea.value.trim() : "";

        // Validate task name
        if (!humanName) {
            return wt('se.k033', 'Название задания не задано. Укажите его в карточке задания перед сохранением.');
        }

        // Validate prompt
        if (!prompt) {
            if (promptArea) {
                promptArea.classList.add('se-field--error');
                if (typeof promptArea.focus === 'function') promptArea.focus();
            }
            return wt('se.k034', 'Введите текст задания.');
        }

        // Validate levels exist
        if (!this.levels.length) {
            return wt('se.k035', 'Добавьте хотя бы один уровень.');
        }

        // 1. In Hierarchy Mode: Validate nodes and their group items
        if (this.displayMode === 'hierarchy' && Array.isArray(this.nodes) && this.nodes.length) {
            // Clear past error highlights before validating
            if (typeof document !== 'undefined') {
                document.querySelectorAll('.se-node-card--error, .se-shake').forEach(el => {
                    el.classList.remove('se-node-card--error', 'se-shake');
                });
                document.querySelectorAll('.se-field--error').forEach(el => {
                    el.classList.remove('se-field--error');
                });
            }

            const emptySlots = [];
            this.nodes.forEach((node) => {
                const tier = this.levels.find(l => l.levelId === node.levelId);
                const tierIdx = this.levels.indexOf(tier);
                const tierName = tier?.title ? `«${tier.title}»` : `#${tierIdx + 1}`;
                const card = typeof document !== 'undefined' ? document.querySelector(`.se-node-card[data-node-id="${node.nodeId}"]`) : null;
                const textareas = card ? Array.from(card.querySelectorAll('.se-node-item-row textarea.block-title-input')) : [];

                (node.items || []).forEach((item, itemIdx) => {
                    const label = String(item.label || '').trim();
                    if (!label) {
                        const textarea = textareas[itemIdx] || null;
                        emptySlots.push({
                            node,
                            tier,
                            tierName,
                            itemIdx,
                            card,
                            textarea
                        });
                    }
                });
            });

            if (emptySlots.length > 0) {
                emptySlots.forEach(({ card, textarea }) => {
                    if (card) {
                        card.classList.remove('se-shake');
                        void card.offsetWidth; // Force reflow so repeated validation triggers CSS keyframes
                        card.classList.add('se-node-card--error', 'se-shake');
                        card.addEventListener('animationend', () => {
                            card.classList.remove('se-shake');
                        }, { once: true });
                    }
                    if (textarea) {
                        textarea.classList.add('se-field--error');
                        textarea.addEventListener('input', () => {
                            textarea.classList.remove('se-field--error');
                            this.clearCardErrorIfResolved(card);
                        }, { once: true });
                    }
                });

                const first = emptySlots[0];
                if (first.card && typeof first.card.scrollIntoView === 'function') {
                    first.card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                }
                if (first.textarea && typeof first.textarea.focus === 'function') {
                    first.textarea.focus();
                }

                if (emptySlots.length === 1) {
                    const firstFilledItem = first.node.items.find(i => String(i.label || '').trim());
                    if (firstFilledItem?.label) {
                        return wt('se.validation_empty_node_item', 'Заполните пустой элемент в карточке «{name}» на уровне {tier} (подсвечен на схеме).')
                            .replace('{name}', firstFilledItem.label)
                            .replace('{tier}', first.tierName);
                    } else {
                        return wt('se.validation_empty_node_item_unnamed', 'Заполните пустой элемент в карточке на уровне {tier} (подсвечен на схеме).')
                            .replace('{tier}', first.tierName);
                    }
                } else {
                    const firstFilledItem = first.node.items.find(i => String(i.label || '').trim());
                    const loc = firstFilledItem?.label ? `«${firstFilledItem.label}» (${first.tierName})` : first.tierName;
                    return wt('se.validation_empty_items_multiple', 'Обнаружено {count} незаполненных элементов (подсвечены на схеме). Переход к первому: {location}.')
                        .replace('{count}', emptySlots.length)
                        .replace('{location}', loc);
                }
            }
        }

        // 2. In Linear Mode: Validate each level has items, and each item has label
        for (let i = 0; i < this.levels.length; i++) {
            const level = this.levels[i];
            if (!level.items || !level.items.length) {
                return wt('sequence_editor.validation.min_one_step', 'В уровне {level} должен быть минимум один шаг.').replace('{level}', i + 1);
            }

            for (let j = 0; j < level.items.length; j++) {
                const label = (level.items[j].label || "").trim();
                if (!label) {
                    if (typeof document !== 'undefined') {
                        const levelCards = document.querySelectorAll('.sequence-level-card');
                        const targetLevelCard = levelCards[i];
                        const block = targetLevelCard?.querySelectorAll('.sequence-block-wrapper')[j];
                        const textarea = block?.querySelector('textarea');
                        if (textarea) {
                            textarea.classList.add('se-field--error');
                            if (typeof textarea.focus === 'function') textarea.focus();
                            if (typeof textarea.scrollIntoView === 'function') textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            textarea.addEventListener('input', () => {
                                textarea.classList.remove('se-field--error');
                            }, { once: true });
                        }
                    }
                    const levelLabel = level.title ? `«${level.title}»` : `#${i + 1}`;
                    return wt('sequence_editor.validation.fill_step_desc', 'Заполните описание шага {step} в уровне {level}.').replace('{step}', j + 1).replace('{level}', levelLabel);
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

        if (this.displayMode !== 'hierarchy') {
            if (singleStepLevels.length > 0) {
                warnings.push(wt('sequence_editor.validation.single_step_levels', 'У {count} уровней только по одному шагу. Проверьте, действительно ли здесь нужна многоуровневая структура.').replace('{count}', singleStepLevels.length));
            }

            if (levels.length > 1 && levels.every((level) => Array.isArray(level?.items) && level.items.length === 1)) {
                warnings.push(wt('se.k037', 'Каждый уровень содержит только один шаг. Такая структура может ощущаться слишком плоской для задания на последовательность.'));
            }
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
                wt('sequence_editor.validation.duplicate_steps', 'Есть одинаковые названия шагов: {steps}. При проверке такие шаги считаются взаимозаменяемыми. Если это разные по смыслу шаги, уточните их текст.').replace('{steps}', duplicates.slice(0, 2).join(", "))
            );
        }

        const ambiguousLevelGroups = Array.from(semanticSignatures.values())
            .filter((indexes) => indexes.length > 1)
            .map((indexes) => indexes.join(', '));

        if (ambiguousLevelGroups.length) {
            warnings.push(
                wt('sequence_editor.validation.ambiguous_levels', 'Уровни {levels} семантически не различаются по составу шагов. На сложностях с вводом названий тренажер не сможет надежно различить такие уровни без разных шагов или разных формулировок.').replace('{levels}', ambiguousLevelGroups[0])
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
        this.colorDifferentiation = true;

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

        content.display_mode = this.displayMode;
        content.color_differentiation = Boolean(this.colorDifferentiation);

        // Build structure
        const { elements, levels, legacySequence, nodes } = this.buildStructure();
        content.elements = elements;
        content.levels = levels;
        content.sequence = legacySequence;
        if (this.displayMode === 'hierarchy') {
            content.nodes = nodes;
        } else {
            delete content.nodes;
        }

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
        s.display_mode = this.displayMode;
        s.color_differentiation = Boolean(this.colorDifferentiation);
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
            name: this.getTaskDisplayName(),
            levels: JSON.parse(JSON.stringify(this.levels)),
            nodes: JSON.parse(JSON.stringify(this.nodes || [])),
            displayMode: this.displayMode,
            colorDifferentiation: true,
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
        if (typeof state?.name === 'string' && state.name.trim() && !/^task_[a-f0-9]{8,}$/i.test(state.name.trim())) {
            if (this.task?.task_data) this.task.task_data.name = state.name.trim();
            if (this.task?.metadata) this.task.metadata.name = state.name.trim();
        }
        this.levels = JSON.parse(JSON.stringify(state.levels || []));
        this.nodes = JSON.parse(JSON.stringify(state.nodes || []));
        if (state.displayMode === 'hierarchy' || state.displayMode === 'linear') {
            this.displayMode = state.displayMode;
        }
        if (typeof state.colorDifferentiation === 'boolean') {
            this.colorDifferentiation = state.colorDifferentiation;
        }
        const content = this.task?.task_data?.content;
        const prompt = typeof state.prompt === 'string' ? state.prompt : '';
        const sequenceWithinLevelMatters = Boolean(state.sequence_within_level_matters);
        const levelOrderMatters = Boolean(state.level_order_matters);

        if (content && typeof content === 'object') {
            content.prompt = prompt;
            content.sequence_within_level_matters = sequenceWithinLevelMatters;
            content.level_order_matters = levelOrderMatters;
            content.display_mode = this.displayMode;
            content.color_differentiation = this.colorDifferentiation;
        }
        if (Object.prototype.hasOwnProperty.call(state, 'taskSettings')) {
            this.restoreTaskSettingsState(state.taskSettings);
        }

        this.updateDisplayModeControls(false);

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

        this.colorDifferentiation = true;

        this.updateSettingsHelpText();
        this.updateTaskTitleDisplay();
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
            window.sequenceEditor = window.editor;
            window.editorInstance = window.editor;
        }
    });
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { SequenceEditor };
}
