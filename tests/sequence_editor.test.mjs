import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(fullPath, 'utf8');
}

function defineGlobal(name, value) {
    Object.defineProperty(global, name, {
        value,
        configurable: true,
        writable: true
    });
}

function setupGlobalDom() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable'
    });
    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('CustomEvent', dom.window.CustomEvent);
    defineGlobal('FormData', dom.window.FormData);
    defineGlobal('File', dom.window.File);
    defineGlobal('Blob', dom.window.Blob);
    defineGlobal('navigator', dom.window.navigator);
    defineGlobal('URL', dom.window.URL);
    dom.window.__SEQUENCE_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);

    // Load dependencies in order
    const undoManagerCode = loadScript('frontend/Editor/undo_manager.js');
    dom.window.eval(undoManagerCode + "\n;window.UndoManager = UndoManager;");

    const baseEditorCode = loadScript('frontend/Editor/base_editor.js');
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(baseEditorCode + "\n;window.BaseEditor = BaseEditor;");

    const autoSaveCode = loadScript('frontend/Editor/autosave_manager.js');
    dom.window.eval(autoSaveCode + "\n;window.AutoSaveManager = AutoSaveManager;");

    const seqEditorCode = loadScript('frontend/Editor/sequence_editor.js');
    dom.window.eval(seqEditorCode + "\n;window.SequenceEditor = SequenceEditor;");

    return dom;
}

let dom = setupGlobalDom();
const SequenceEditor = dom.window.SequenceEditor;

function mountEditorDom() {
    document.body.innerHTML = `
        <button type="button" class="onboarding-help-button" data-onboarding-help-button data-onboarding-tour-id="sequence-editor-authoring"></button>
        <div id="save-status-container">
            <div id="save-status-indicator"></div>
            <span id="save-status-text" data-i18n="seq_editor.status_saved">Сохранено</span>
            <span id="save-status-detail"></span>
        </div>
        <input id="task-name-input" />
        <textarea id="prompt-textarea"></textarea>
        <input id="order-inside-matters" type="checkbox" />
        <input id="level-order-matters" type="checkbox" />
        <span id="settings-mode-icon"></span>
        <span id="settings-mode-badge"></span>
        <div id="settings-help-text"></div>
        <div id="levels-container"></div>
        <button id="clear-all-btn"></button>
        <button id="add-level-btn"><span data-i18n="seq_editor.add_level_btn">Добавить уровень</span></button>
        <button id="save-task-btn"></button>
        <input id="block-image-upload" type="file" />
        <aside>
            <div id="sequence-sidebar-content" class="p-5 space-y-6">
                <div data-onboarding-target="sequence-display-mode-block" class="space-y-2">
                    <label data-i18n="se.display_mode_label">Вид структуры</label>
                    <div id="se-display-mode-tabs" class="se-mode-tabs se-mode-tabs--sidebar w-full grid grid-cols-2" role="tablist">
                        <span id="se-mode-tabs-pill" class="se-mode-tabs__pill"></span>
                        <button type="button" id="mode-tab-linear" role="tab" aria-selected="true" class="se-mode-tabs__tab is-active">
                            <span data-i18n="se.display_mode_linear_short">Линейная</span>
                        </button>
                        <button type="button" id="mode-tab-hierarchy" role="tab" aria-selected="false" class="se-mode-tabs__tab">
                            <span data-i18n="se.display_mode_hierarchy_short">Иерархия</span>
                        </button>
                    </div>
                </div>
                <div id="editor-difficulty-authoring-mount"></div>
            </div>
        </aside>
    `;
}

function createEditorInstance() {
    const initSpy = vi.spyOn(SequenceEditor.prototype, 'init').mockImplementation(() => {});
    const instance = new SequenceEditor();
    initSpy.mockRestore();
    return instance;
}

describe('SequenceEditor', () => {
    let editor;

    beforeEach(() => {
        mountEditorDom();
        dom.window.alert = vi.fn();
        dom.window.fetch = vi.fn();
        editor = createEditorInstance();
        editor.moduleId = 'module_01';
        editor.topicId = 'topic_01';
        editor.taskId = 'task_999';
        editor.task = {
            task_data: {
                name: '',
                meta: { module: 'module_01', topic: 'topic_01' },
                content: {}
            },
            metadata: { id: 'task_999' }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('buildStructure normalizes elements and levels', () => {
        editor.levels = [
            {
                levelId: 'level_a',
                title: 'Первый',
                items: [
                    { id: 'elem_1', label: 'Шаг А1', target_image: 'img1.png' },
                    { id: 'elem_2', label: 'Шаг А2', target_image: '' }
                ]
            },
            {
                levelId: 'level_b',
                title: '',
                items: [
                    { id: 'elem_1', label: 'Шаг А1', target_image: 'img1.png' },
                    { id: 'elem_3', label: 'Шаг B1', target_image: '' }
                ]
            }
        ];

        const result = editor.buildStructure();

        expect(result.elements).toHaveLength(3);
        expect(result.levels).toHaveLength(2);
        expect(result.levels[1].level_name).toBeUndefined();
        expect(result.levels[0].blocks).toEqual(['elem_1', 'elem_2']);
        expect(result.legacySequence[0].items[0]).toEqual({ id: 'elem_1', label: 'Шаг А1' });
    });

    it('saveTask posts normalized payload with elements and levels', async () => {
        document.querySelector('#task-name-input').value = 'Задание';
        document.querySelector('#prompt-textarea').value = 'Инструкция';
        document.querySelector('#order-inside-matters').checked = true;
        document.querySelector('#level-order-matters').checked = false;

        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Уровень 1',
                items: [
                    { id: 'elem_1', label: 'Шаг 1', target_image: 'modules/img1.png' },
                    { id: 'elem_2', label: 'Шаг 2', target_image: '' }
                ]
            }
        ];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();

        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.elements).toHaveLength(2);
        expect(payload.content.levels).toEqual([
            {
                level_id: 'level_1',
                level_name: 'Уровень 1',
                blocks: ['elem_1', 'elem_2']
            }
        ]);
        expect(payload.content.sequence).toHaveLength(1);
        expect(payload.content.sequence_within_level_matters).toBe(true);
        expect(payload.content.level_order_matters).toBe(false);
        expect(dom.window.alert).not.toHaveBeenCalled();
    });

    it('saveTask validates missing step descriptions', async () => {
        document.querySelector('#task-name-input').value = 'Задание';
        document.querySelector('#prompt-textarea').value = 'Инструкция';

        editor.levels = [
            {
                levelId: 'level_1',
                title: '',
                items: [{ id: 'elem_1', label: '', target_image: '' }]
            }
        ];

        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});
        await editor.saveTask();

        expect(dom.window.fetch).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Заполните описание шага 1'), 'warning');
    });

    it('saveTask surfaces semantic warnings for weak sequence structure', async () => {
        document.querySelector('#task-name-input').value = 'Задание';
        document.querySelector('#prompt-textarea').value = 'Инструкция';

        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Уровень 1',
                items: [{ id: 'elem_1', label: 'Шаг 1', target_image: '' }]
            },
            {
                levelId: 'level_2',
                title: 'Уровень 2',
                items: [{ id: 'elem_2', label: 'Шаг 1', target_image: '' }]
            }
        ];

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        const statusSpy = vi.spyOn(editor, 'updateSaveStatus');
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

        await editor.saveTask();

        expect(statusSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('замечания'), 'warning', 5200);
        expect(toastSpy).not.toHaveBeenCalledWith('Задание сохранено', 'success');
        expect(editor.getSemanticWarnings().join(' ')).toContain('взаимозаменяемыми');
        expect(editor.getSemanticWarnings().join(' ')).toContain('семантически не различаются');
    });

    it('buildStructure assigns same semantic_key to equal labels with different ids', () => {
        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Level 1',
                items: [
                    { id: 'elem_1', label: 'Same step', image: '' },
                    { id: 'elem_2', label: 'Same   step', image: '' }
                ]
            }
        ];

        const result = editor.buildStructure();
        const semanticKeys = result.elements.map((item) => item.semantic_key);

        expect(semanticKeys).toEqual(['text:same step', 'text:same step']);
    });

    it('deleteLevel prevents removing the last level', async () => {
        editor.levels = [
            { levelId: 'level_1', title: '', items: [{ id: 'elem_1', label: 'Шаг', target_image: '' }] }
        ];
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

        await editor.deleteLevel(0);

        expect(toastSpy).toHaveBeenCalledWith('Должен остаться минимум один уровень.', 'error');
        expect(editor.levels).toHaveLength(1);
    });

    it('deleteBlock prevents removing the last block in a level', () => {
        editor.levels = [
            { levelId: 'level_1', title: '', items: [{ id: 'elem_1', label: 'Шаг', target_image: '' }] }
        ];
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

        editor.deleteBlock(0, 0);

        expect(toastSpy).toHaveBeenCalledWith('В уровне должен быть хотя бы один шаг.', 'error');
        expect(editor.levels[0].items).toHaveLength(1);
    });

    it('captureState and restoreState preserve prompt and sequence settings', () => {
        document.querySelector('#prompt-textarea').value = 'Черновик последовательности';
        document.querySelector('#order-inside-matters').checked = true;
        document.querySelector('#level-order-matters').checked = true;

        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Подготовка',
                items: [
                    { id: 'elem_1', label: 'Шаг 1', target_image: '' },
                    { id: 'elem_2', label: 'Шаг 2', target_image: '' }
                ]
            },
            {
                levelId: 'level_2',
                title: 'Проверка',
                items: [
                    { id: 'elem_3', label: 'Контроль', target_image: '' }
                ]
            }
        ];
        editor.renderLevels();

        const snapshot = editor.captureState();

        document.querySelector('#prompt-textarea').value = 'Другое значение';
        document.querySelector('#order-inside-matters').checked = false;
        document.querySelector('#level-order-matters').checked = false;
        editor.levels = [
            {
                levelId: 'level_other',
                title: 'Сброшено',
                items: [{ id: 'elem_x', label: 'Пусто', target_image: '' }]
            }
        ];
        editor.renderLevels();

        editor.restoreState(snapshot);

        expect(document.querySelector('#prompt-textarea').value).toBe('Черновик последовательности');
        expect(document.querySelector('#order-inside-matters').checked).toBe(true);
        expect(document.querySelector('#level-order-matters').checked).toBe(true);
        expect(editor.levels).toHaveLength(2);
        expect(document.querySelectorAll('.level-title-input')).toHaveLength(2);
        expect(document.querySelector('.level-title-input').value).toBe('Подготовка');
        expect(document.querySelectorAll('.block-title-input')[0].value).toBe('Шаг 1');
        expect(document.querySelectorAll('.block-title-input')[2].value).toBe('Контроль');
    });

    it('renders compact step controls to keep narrow cards stable', () => {
        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Level 1',
                items: [
                    { id: 'elem_1', label: 'Step 1', image: null, semanticKey: null }
                ]
            }
        ];

        editor.renderLevels();

        const actionRow = document.querySelector('.sequence-block-actions');
        const moveLeft = document.querySelector('.move-left');
        const moveRight = document.querySelector('.move-right');
        const deleteBtn = document.querySelector('.delete-block');
        const addBtn = document.querySelector('.sequence-add-block-btn');
        const levelActions = document.querySelector('.sequence-level-actions');

        expect(actionRow).not.toBeNull();
        expect(actionRow.className).toContain('grid');
        expect(actionRow.className).toContain('grid-cols-2');
        expect(moveLeft.className).toContain('btn-secondary--compact');
        expect(moveLeft.className).toContain('sequence-block-move-btn');
        expect(moveRight.className).toContain('btn-secondary--compact');
        expect(deleteBtn.className).toContain('icon-button-muted--xs');
        expect(addBtn.className).toContain('empty-state-card--icon-only');
        expect(levelActions.className).toContain('sequence-level-actions');
    });

    it('elevates stacking context and toggles header collapse button on expand/collapse', () => {
        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Level 1',
                items: [
                    { id: 'elem_1', label: 'Long step description with multiple details to test overlay expansion', image: null }
                ]
            }
        ];

        editor.renderLevels();

        const card = document.querySelector('.sequence-block-card');
        const wrapper = document.querySelector('.sequence-block-wrapper');
        const level = document.querySelector('.sequence-level-card');
        const headerCollapse = document.querySelector('.sequence-block-header-collapse-btn');

        expect(card).not.toBeNull();
        expect(wrapper).not.toBeNull();
        expect(level).not.toBeNull();
        expect(headerCollapse).not.toBeNull();

        // Initially not expanded
        expect(card.classList.contains('is-expanded')).toBe(false);
        expect(wrapper.classList.contains('has-expanded-card')).toBe(false);
        expect(level.classList.contains('has-expanded-card')).toBe(false);

        // Expand
        editor.expandBlock(card);
        expect(card.classList.contains('is-expanded')).toBe(true);
        expect(wrapper.classList.contains('has-expanded-card')).toBe(true);
        expect(level.classList.contains('has-expanded-card')).toBe(true);
        expect(headerCollapse.style.display).toBe('inline-flex');

        // Collapse via header collapse button
        headerCollapse.click();
        expect(card.classList.contains('is-expanded')).toBe(false);
        expect(wrapper.classList.contains('has-expanded-card')).toBe(false);
        expect(level.classList.contains('has-expanded-card')).toBe(false);
    });

    it('mounts difficulty authoring controls in sidebar with sequence-specific copy and saves allowed_difficulties', async () => {
        editor.task.task_data.type = 'sequence_assembly';
        editor.task.task_data.name = 'Этапы стерилизации';
        editor.task.task_data.settings = {};
        document.querySelector('#prompt-textarea').value = 'Расположите этапы по уровням';
        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Этап 1',
                items: [
                    { id: 'elem_1', label: 'Шаг 1', image: null },
                    { id: 'elem_2', label: 'Шаг 2', image: null },
                ],
            },
        ];

        const metaPayload = {
            ok: true,
            meta: {
                task_type: 'SEQUENCE_ASSEMBLY',
                subtype: null,
                supported_levels: [1, 2, 3],
                authoring_enabled: true,
                level_role_map: [
                    { level: 1, role: 'Пользователь раскладывает элементы по уровням или группам.' },
                    { level: 2, role: 'Пользователь раскладывает элементы и подписывает уровни.' },
                    { level: 3, role: 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.' },
                ],
            },
        };

        dom.window.fetch.mockImplementation((url) => {
            if (String(url).includes('/api/editor/difficulty-meta')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(metaPayload),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ok: true }),
            });
        });

        editor.onTaskLoaded();
        document.querySelector('#prompt-textarea').value = 'Расположите этапы по уровням';
        editor.levels = [
            {
                levelId: 'level_1',
                title: 'Этап 1',
                items: [
                    { id: 'elem_1', label: 'Шаг 1', image: null },
                    { id: 'elem_2', label: 'Шаг 2', image: null },
                ],
            },
        ];
        const mounted = await editor.refreshDifficultyAuthoringControls();
        expect(mounted).toBe(true);

        const diffSection = document.querySelector('#editor-difficulty-authoring');
        expect(diffSection).not.toBeNull();
        expect(diffSection.textContent).toContain('Доступные уровни сложности');
        expect(diffSection.textContent).toContain('последовательность');
        expect(diffSection.textContent).not.toContain('Click');

        const levelInputs = diffSection.querySelectorAll('[data-difficulty-level]');
        expect(levelInputs).toHaveLength(3);

        // Select custom mode and uncheck level 3 -> [1, 2]
        editor.setDifficultyAuthoringMode('custom');
        editor.toggleDifficultyAuthoringLevel(3, false);

        expect(editor.task.task_data.settings.allowed_difficulties).toEqual([1, 2]);
        expect(diffSection.querySelector('.difficulty-authoring__toggle-summary').textContent).toBe('L1, L2');

        await editor.saveTask();
        const saveCalls = dom.window.fetch.mock.calls.filter(([url]) => String(url).includes('/api/editor/task/'));
        expect(saveCalls).toHaveLength(1);
        const savedPayload = JSON.parse(saveCalls[0][1].body);
        expect(savedPayload.settings.allowed_difficulties).toEqual([1, 2]);
        expect(savedPayload.settings.__difficulty_authoring_mode).toBeUndefined();
    });

    it('re-renders sidebar settings, difficulty authoring, save status, and level controls when locale changes to English', async () => {
        const metaPayload = {
            ok: true,
            meta: {
                task_type: 'sequence_assembly',
                supported_levels: [1, 2, 3],
                authoring_enabled: true,
                level_role_map: [
                    { level: 1, role: 'Пользователь раскладывает элементы по уровням или группам.' },
                    { level: 2, role: 'Пользователь раскладывает элементы и подписывает уровни.' },
                    { level: 3, role: 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.' },
                ],
            },
        };

        dom.window.fetch.mockImplementation((url) => {
            if (String(url).includes('/api/editor/difficulty-meta')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(metaPayload),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ok: true }),
            });
        });

        editor.onTaskLoaded();
        await editor.refreshDifficultyAuthoringControls();

        const enDict = {
            'se.k003': 'New task',
            'se.k004': 'The given order of levels and the order of elements within each level must be followed.',
            'se.k006': 'The order of elements within each level matters. The order of the levels themselves is not considered.',
            'se.k008': 'Level name',
            'se.k015': 'Describe the element...',
            'se.k016': 'Left',
            'se.k017': 'Right',
            'se.mode_strict': 'Strict Sequence',
            'se.mode_steps_only': 'Element Order Only',
            'seq_editor.status_saved': 'Saved',
            'seq_editor.status_unsaved': 'Unsaved',
            'seq_editor.add_step_btn': 'Add step',
            'editor_base.lbl_all_levels_of_type': 'All levels of type',
            'editor_base.difficulty.title': 'Available difficulty levels',
            'editor_base.difficulty.all_title': 'All levels of type',
            'editor_base.difficulty.custom_title': 'Selected levels only',
            'editor_base.difficulty.custom_description': 'Show the task only on the selected iterations.',
            'editor_base.difficulty.level_title': 'Level {level}',
            'editor_base.difficulty.sequence.intro': 'A standard complex has 3 iterations. Choose on which of them this sequence task will appear.',
            'editor_base.difficulty.sequence.all_description': 'Show the task on all 3 sequence levels.',
            'editor_base.difficulty.sequence.1': 'The user arranges elements into levels or groups.',
            'editor_base.difficulty.sequence.2': 'The user arranges elements and labels the levels.',
            'editor_base.difficulty.sequence.3': 'The user arranges elements and labels both levels and elements.',
        };

        dom.window.i18n = {
            t: (key) => enDict[key] || key,
            updateDOM: () => {},
        };

        dom.window.dispatchEvent(new dom.window.CustomEvent('i18n:changed', { detail: { lang: 'en' } }));

        expect(document.querySelector('#save-status-text').textContent).toBe('Saved');
        expect(document.querySelector('#settings-mode-badge').textContent).toBe('Strict Sequence');
        expect(document.querySelector('#settings-help-text').textContent).toContain('The given order of levels and the order of elements');

        const diffSection = document.querySelector('#editor-difficulty-authoring');
        expect(diffSection.textContent).toContain('Available difficulty levels');
        expect(diffSection.textContent).toContain('All levels of type');
        expect(diffSection.textContent).toContain('The user arranges elements into levels or groups.');
        expect(diffSection.textContent).not.toMatch(/[\u0400-\u04FF]/);

        const levelInput = document.querySelector('.level-title-input');
        expect(levelInput.getAttribute('placeholder')).toBe('Level name');
        const stepInput = document.querySelector('.block-title-input');
        expect(stepInput.getAttribute('placeholder')).toBe('Describe the element...');
        const addStepBtn = document.querySelector('.sequence-add-block-btn');
        expect(addStepBtn.textContent).toContain('Add step');
    });

    it('applyQuickTable builds N×M hierarchy grid and serializes nodes, display_mode, and color_differentiation', async () => {
        document.querySelector('#task-name-input').value = 'Таблица 5.1';
        document.querySelector('#prompt-textarea').value = 'Классифицируйте признаки';
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

        editor.colorDifferentiation = true;
        editor.applyQuickTable(2, 3);

        expect(editor.displayMode).toBe('hierarchy');
        expect(editor.levels).toHaveLength(3);
        expect(editor.nodes).toHaveLength(6);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('2 × 3'), 'info');

        // Fill labels in all 6 nodes so validation passes
        editor.levels[0].title = 'Заболевание';
        editor.levels[1].title = 'Прозрачность';
        editor.levels[2].title = 'Смещение';
        editor.nodes.forEach((node, idx) => {
            node.items[0].label = `Признак ${idx + 1}`;
        });
        editor.renderLevels();

        expect(document.querySelector('.se-hierarchy-shell')).not.toBeNull();
        expect(document.querySelectorAll('.se-tier-cell')).toHaveLength(3);
        expect(document.querySelectorAll('.se-node-card')).toHaveLength(6);

        dom.window.fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true })
        });

        await editor.saveTask();
        expect(dom.window.fetch).toHaveBeenCalledTimes(1);
        const [, options] = dom.window.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);

        expect(payload.content.display_mode).toBe('hierarchy');
        expect(payload.content.color_differentiation).toBe(true);
        expect(payload.settings.display_mode).toBe('hierarchy');
        expect(payload.settings.color_differentiation).toBe(true);
        expect(payload.content.elements).toHaveLength(6);
        expect(payload.content.levels).toHaveLength(3);
        expect(payload.content.nodes).toHaveLength(6);
        // First 2 nodes are root nodes (parent_id: null)
        expect(payload.content.nodes[0].parent_id).toBeNull();
        expect(payload.content.nodes[1].parent_id).toBeNull();
        // Second tier nodes link to root nodes
        expect(payload.content.nodes[2].parent_id).toBe(payload.content.nodes[0].node_id);
        expect(payload.content.nodes[3].parent_id).toBe(payload.content.nodes[1].node_id);
    });

    it('enforces Variant B rule: splits multi-item leaf container-group into sibling nodes when addChildNode is called', () => {
        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});
        editor.setDisplayMode('hierarchy');

        // Pick a leaf node on tier 2 and add a second item to make it a 2-slot container-group
        const tier2LevelId = editor.levels[1].levelId;
        const leafNode = editor.nodes.find(n => n.levelId === tier2LevelId);
        leafNode.items[0].label = 'Инородное тело бронха';
        editor.addItemToNode(leafNode.nodeId);
        expect(leafNode.items).toHaveLength(2);
        leafNode.items[1].label = 'Слизистая пробка';

        const countBefore = editor.nodes.filter(n => n.levelId === tier2LevelId).length;

        // Now add a child node to leafNode -> must split leafNode's 2 items into 2 sibling nodes on tier 2 and create a child on tier 3
        editor.addChildNode(leafNode.nodeId);

        expect(leafNode.items).toHaveLength(1);
        expect(leafNode.items[0].label).toBe('Инородное тело бронха');
        const tier2NodesAfter = editor.nodes.filter(n => n.levelId === tier2LevelId);
        expect(tier2NodesAfter).toHaveLength(countBefore + 1);
        expect(tier2NodesAfter.some(n => n.items[0]?.label === 'Слизистая пробка')).toBe(true);
        expect(editor.levels).toHaveLength(3);
        const childOnTier3 = editor.nodes.find(n => n.parentId === leafNode.nodeId);
        expect(childOnTier3).toBeDefined();
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('Группа разделена на отдельные узлы'),
            'info'
        );
    });

    it('captureState and restoreState preserve hierarchy nodes, displayMode, and colorDifferentiation', () => {
        editor.colorDifferentiation = true;
        editor.applyQuickTable(2, 2);
        editor.levels[0].title = 'Группа';
        editor.levels[1].title = 'Подгруппа';
        editor.nodes[0].items[0].label = 'Ателектаз';
        editor.nodes[1].items[0].label = 'Пневмоторакс';
        editor.nodes[2].items[0].label = 'Затемнение';
        editor.nodes[3].items[0].label = 'Просветление';

        const snapshot = editor.captureState();

        editor.setDisplayMode('linear');
        editor.colorDifferentiation = false;
        editor.levels = [editor.createEmptyLevel()];
        editor.nodes = [];

        editor.restoreState(snapshot);

        expect(editor.displayMode).toBe('hierarchy');
        expect(editor.colorDifferentiation).toBe(true);
        expect(editor.levels).toHaveLength(2);
        expect(editor.nodes).toHaveLength(4);
        expect(editor.nodes[0].items[0].label).toBe('Ателектаз');
        expect(document.querySelector('.se-hierarchy-shell')).not.toBeNull();
    });

    it('manages structure view switcher in sidebar and toggles hierarchy canvas', () => {
        const modeTabs = document.querySelector('#se-display-mode-tabs');
        expect(modeTabs).not.toBeNull();
        expect(modeTabs.closest('aside')).not.toBeNull();

        const tabLinear = document.querySelector('#mode-tab-linear');
        const tabHierarchy = document.querySelector('#mode-tab-hierarchy');

        // Initial default: linear
        editor.displayMode = 'linear';
        editor.updateDisplayModeControls(true);
        expect(tabLinear.classList.contains('is-active')).toBe(true);
        expect(tabHierarchy.classList.contains('is-active')).toBe(false);

        // Switch to hierarchy
        editor.setDisplayMode('hierarchy');
        expect(editor.displayMode).toBe('hierarchy');
        expect(tabLinear.classList.contains('is-active')).toBe(false);
        expect(tabHierarchy.classList.contains('is-active')).toBe(true);
        expect(tabHierarchy.getAttribute('aria-selected')).toBe('true');
        expect(document.querySelector('.se-hierarchy-shell')).not.toBeNull();

        // Switch back to linear
        editor.setDisplayMode('linear');
        expect(editor.displayMode).toBe('linear');
        expect(tabLinear.classList.contains('is-active')).toBe(true);
        expect(tabHierarchy.classList.contains('is-active')).toBe(false);
        expect(document.querySelector('.se-hierarchy-shell')).toBeNull();
    });

    it('renders clean de-nested node cards without nested card boxes or clutter', () => {
        editor.applyQuickTable(2, 2);
        const card = document.querySelector('.se-node-card');
        expect(card).not.toBeNull();

        // 1. Single surface: inside card, there should not be any nested .sequence-block-card or nested .se-node-card
        const nestedCards = card.querySelectorAll('.se-node-card, .sequence-block-card');
        expect(nestedCards.length).toBe(0);

        // 2. Textarea has se-node-item-input class for flat, seamless typography
        const textarea = card.querySelector('textarea.block-title-input');
        expect(textarea).not.toBeNull();
        expect(textarea.classList.contains('se-node-item-input')).toBe(true);

        // 3. Header actions exist for contextual reveal
        const headerActions = card.querySelector('.se-node-header-actions');
        expect(headerActions).not.toBeNull();
        expect(card.querySelector('.delete-node')).not.toBeNull();

        // 4. Footer has micro action buttons
        const footer = card.querySelector('.se-node-footer');
        expect(footer).not.toBeNull();
        expect(card.querySelector('.add-child-node-btn')).not.toBeNull();
        expect(card.querySelector('.add-sibling-node-btn')).not.toBeNull();
    });

    it('synchronizes tier cell header, badge, actions, and geometry with node cards', () => {
        editor.applyQuickTable(2, 2);
        const tierCell = document.querySelector('.se-tier-cell');
        expect(tierCell).not.toBeNull();

        // 1. Header has matching badge and contextual actions
        const tierHeader = tierCell.querySelector('.se-tier-cell-header');
        expect(tierHeader).not.toBeNull();
        const tierBadge = tierCell.querySelector('.se-tier-badge');
        expect(tierBadge).not.toBeNull();
        expect(tierBadge.textContent.trim()).toBe('1');

        const tierActions = tierCell.querySelector('.se-tier-actions');
        expect(tierActions).not.toBeNull();
        expect(tierCell.querySelector('.move-up')).not.toBeNull();
        expect(tierCell.querySelector('.move-down')).not.toBeNull();
        expect(tierCell.querySelector('.delete-level')).not.toBeNull();

        // 2. Input container and input class
        const tierBody = tierCell.querySelector('.se-tier-body');
        expect(tierBody).not.toBeNull();
        const input = tierBody.querySelector('.level-title-input');
        expect(input).not.toBeNull();
        expect(input.classList.contains('se-tier-input')).toBe(true);

        // 3. Row cells present in same grid row
        const nodeCell = document.querySelector('.se-node-cell');
        expect(nodeCell).not.toBeNull();
        expect(tierCell.style.gridRow).toBe(nodeCell.style.gridRow);
    });

    it('renders native inline actions for columns and tiers with DLP safeguard on destructive reset', () => {
        editor.applyQuickTable(2, 2);
        editor.nodes[0].items[0].label = 'Важный диагноз';

        // 1. Verify inline buttons in canvas top actions
        const addColBtn = document.querySelector('.add-root-node-btn');
        const addTierBtn = document.querySelector('.add-tier-top-btn');
        expect(addColBtn).not.toBeNull();
        expect(addTierBtn).not.toBeNull();
        expect(addColBtn.textContent).toContain('Колонка');

        // 2. Click + Колонка -> increases root nodes
        const rootNodesBefore = editor.nodes.filter(n => !n.parentId).length;
        addColBtn.click();
        const rootNodesAfter = editor.nodes.filter(n => !n.parentId).length;
        expect(rootNodesAfter).toBe(rootNodesBefore + 1);

        // 3. Click + Уровень -> increases levels
        const levelsBefore = editor.levels.length;
        addTierBtn.click();
        expect(editor.levels.length).toBe(levelsBefore + 1);

        // 4. DLP safeguard on applyQuickTable
        dom.window.confirm = vi.fn(() => false); // User cancels
        editor.applyQuickTable(3, 3);
        // Data must be preserved because user cancelled
        expect(editor.nodes[0].items[0].label).toBe('Важный диагноз');

        dom.window.confirm = vi.fn(() => true); // User confirms
        editor.applyQuickTable(3, 3);
        // Now it re-creates the grid
        expect(editor.levels).toHaveLength(3);
    });

    it('integrates zoom HUD inside hierarchy toolbar with in, out, reset, fit, and minimap toggle', () => {
        editor.applyQuickTable(2, 2);
        const toolbar = document.querySelector('#se-hierarchy-toolbar');
        expect(toolbar).not.toBeNull();

        const zoomIn = toolbar.querySelector('#se-zoom-in');
        const zoomOut = toolbar.querySelector('#se-zoom-out');
        const zoomReset = toolbar.querySelector('#se-zoom-reset');
        const zoomFit = toolbar.querySelector('#se-zoom-fit');
        const minimapToggle = toolbar.querySelector('#se-minimap-toggle');

        expect(zoomIn).not.toBeNull();
        expect(zoomOut).not.toBeNull();
        expect(zoomReset).not.toBeNull();
        expect(zoomFit).not.toBeNull();
        expect(minimapToggle).not.toBeNull();

        // 1. Zoom In
        editor.canvasZoom = 1.0;
        zoomIn.click();
        expect(editor.canvasZoom).toBe(1.1);
        expect(zoomReset.textContent.trim()).toBe('110%');

        // 2. Zoom Out
        zoomOut.click();
        expect(editor.canvasZoom).toBe(1.0);
        expect(zoomReset.textContent.trim()).toBe('100%');

        // 3. Reset Zoom to 1.0
        editor.canvasZoom = 1.3;
        zoomReset.click();
        expect(editor.canvasZoom).toBe(1.0);

        // 4. Fit to Viewport
        const fitSpy = vi.spyOn(editor, 'fitToViewport');
        zoomFit.click();
        expect(fitSpy).toHaveBeenCalled();

        // 5. Toggle Minimap
        const initialMinimap = editor.minimapVisible;
        minimapToggle.click();
        expect(editor.minimapVisible).toBe(!initialMinimap);
        minimapToggle.click();
        expect(editor.minimapVisible).toBe(initialMinimap);
    });

    it('preserves element labels on undo/redo across text inputs and mutations', () => {
        editor.displayMode = 'hierarchy';
        editor.levels = [{ levelId: 'tier_1', title: 'Уровень 1', items: [] }];
        editor.nodes = [
            editor.createEmptyNode({
                levelId: 'tier_1',
                parentId: null,
                items: [{ id: 'elem_1', label: '' }]
            })
        ];
        editor.syncLevelsFromNodes();
        editor.renderLevels();
        editor.saveStateToHistory(); // Base state 0

        // Step 1: User types text into node 1
        editor.nodes[0].items[0].label = 'Тромболизис';
        editor.scheduleHistorySave(10);
        editor.flushPendingHistorySave(); // State 1: with text

        // Step 2: User adds a sibling node
        editor.addSiblingNode(editor.nodes[0].nodeId); // State 2: node 1 (Тромболизис) + node 2 (empty)
        expect(editor.nodes).toHaveLength(2);
        expect(editor.nodes[0].items[0].label).toBe('Тромболизис');

        // Step 3: User hits Ctrl+Z (undo)
        editor.performUndo();

        // Node 2 must be undone, AND Node 1's text MUST BE PRESERVED!
        expect(editor.nodes).toHaveLength(1);
        expect(editor.nodes[0].items[0].label).toBe('Тромболизис');

        // Step 4: Redo brings back node 2 with node 1 text still preserved
        editor.performRedo();
        expect(editor.nodes).toHaveLength(2);
        expect(editor.nodes[0].items[0].label).toBe('Тромболизис');
    });

    it('highlights empty items on canvas and provides informative error messages in hierarchy mode', async () => {
        document.querySelector('#task-name-input').value = 'ТЭЛА';
        document.querySelector('#prompt-textarea').value = 'Определите тактику';

        editor.displayMode = 'hierarchy';
        editor.levels = [{ levelId: 'tier_1', title: 'Стратификация риска', items: [] }];
        editor.nodes = [
            editor.createEmptyNode({
                levelId: 'tier_1',
                parentId: null,
                items: [
                    { id: 'elem_1', label: 'Высокий риск' },
                    { id: 'elem_2', label: '' } // Empty item in group
                ]
            })
        ];
        editor.syncLevelsFromNodes();
        editor.renderLevels();

        const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});
        await editor.saveTask();

        // 1. Toast must be informative and mention the card title or level
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('Высокий риск'),
            'warning'
        );

        // 2. DOM element must be visually highlighted with .se-field--error
        const card = document.querySelector(`.se-node-card[data-node-id="${editor.nodes[0].nodeId}"]`);
        expect(card).toBeTruthy();
        expect(card.classList.contains('se-node-card--error')).toBe(true);

        const emptyTextarea = card.querySelectorAll('.block-title-input')[1];
        expect(emptyTextarea.classList.contains('se-field--error')).toBe(true);
    });

    describe('Stage 2: Kinetic transitions, zoom panorama and linear order fixes', () => {
        it('2.2: addBlock inserts new step strictly BEFORE add button and updates badges and move buttons', () => {
            editor.displayMode = 'linear';
            editor.levels = [
                {
                    levelId: 'lvl_1',
                    title: 'Шаг 1',
                    items: [{ id: 'b1', label: 'Первый шаг' }]
                }
            ];
            editor.renderLevels();

            const container = document.querySelector('.sequence-level-blocks') || document.querySelector('#levels-container');
            const addBtn = document.querySelector('.sequence-add-block-btn');
            expect(addBtn).toBeTruthy();

            // First block initially has move-right disabled
            const initialBlocks = document.querySelectorAll('.sequence-block-wrapper');
            expect(initialBlocks).toHaveLength(1);
            expect(initialBlocks[0].querySelector('.move-right').disabled).toBe(true);

            // Add 2nd block
            editor.addBlock(0);

            const allWrappers = Array.from(document.querySelectorAll('.sequence-block-wrapper'));
            expect(allWrappers).toHaveLength(2);

            // Assert DOM order: new block must be immediately before addBtn
            expect(addBtn.previousElementSibling).toBe(allWrappers[1]);

            // Assert badges
            expect(allWrappers[0].querySelector('.sequence-block-badge').textContent.trim()).toBe('#1');
            expect(allWrappers[1].querySelector('.sequence-block-badge').textContent.trim()).toBe('#2');

            // Assert move buttons: first block move-right must now be ENABLED!
            expect(allWrappers[0].querySelector('.move-left').disabled).toBe(true);
            expect(allWrappers[0].querySelector('.move-right').disabled).toBe(false);

            // Second block: move-left enabled, move-right disabled
            expect(allWrappers[1].querySelector('.move-left').disabled).toBe(false);
            expect(allWrappers[1].querySelector('.move-right').disabled).toBe(true);
        });

        it('2.3: syncNodeCardGroupBadge dynamically adds "Группа (2)" and removes it when single item remains', () => {
            vi.useFakeTimers();
            editor.displayMode = 'hierarchy';
            editor.levels = [{ levelId: 'tier_1', title: 'Категория 1', items: [] }];
            const node = editor.createEmptyNode({
                levelId: 'tier_1',
                parentId: null,
                items: [{ id: 'item_1', label: 'Признак 1' }]
            });
            editor.nodes = [node];
            editor.syncLevelsFromNodes();
            editor.renderLevels();

            const card = document.querySelector(`.se-node-card[data-node-id="${node.nodeId}"]`);
            expect(card).toBeTruthy();
            expect(card.classList.contains('is-leaf-group')).toBe(false);
            expect(card.querySelector('.se-node-group-badge')).toBeNull();

            // Add second item
            editor.addItemToNode(node.nodeId);
            expect(card.classList.contains('is-leaf-group')).toBe(true);
            const badge = card.querySelector('.se-node-group-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toContain('2');

            // Delete second item
            editor.deleteItemFromNode(node.nodeId, 1);
            vi.advanceTimersByTime(200);

            expect(card.classList.contains('is-leaf-group')).toBe(false);
            expect(card.querySelector('.se-node-group-badge')).toBeNull();
            vi.useRealTimers();
        });

        it('2.4: setCanvasZoom preserves pan offset when recenter is false, centers when recenter is true', () => {
            editor.displayMode = 'hierarchy';
            editor.levels = [{ levelId: 't1', title: 'Tier 1', items: [] }];
            editor.nodes = [
                editor.createEmptyNode({ levelId: 't1', parentId: null, items: [{ id: 'i1', label: 'Root' }] })
            ];
            editor.renderLevels();

            // Set arbitrary pan from user dragging
            editor.panX = 350;
            editor.panY = 120;
            editor.canvasZoom = 1.0;

            const viewport = document.querySelector('#se-hierarchy-viewport');
            if (viewport) {
                Object.defineProperty(viewport, 'clientWidth', { value: 1000, configurable: true });
                Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true });
            }

            // Normal zoom (slider or wheel): recenter = false
            editor.setCanvasZoom(1.20, 0.40, 1.50, { recenter: false });
            expect(editor.canvasZoom).toBe(1.2);
            // Pan must not be slammed to 24
            expect(editor.panX).not.toBe(24);

            // Fit to viewport: recenter = true
            editor.setCanvasZoom(0.80, 0.40, 1.50, { recenter: true });
            expect(editor.canvasZoom).toBe(0.8);
            // Must recalculate center
            expect(editor.panX).toBeDefined();
        });

        it('2.4: minimap draws connector paths using this.nodes', () => {
            editor.displayMode = 'hierarchy';
            editor.minimapVisible = true;
            editor.levels = [
                { levelId: 't1', title: 'Tier 1', items: [] },
                { levelId: 't2', title: 'Tier 2', items: [] }
            ];
            const rootNode = editor.createEmptyNode({ levelId: 't1', parentId: null, items: [{ id: 'r1', label: 'Root' }] });
            const childNode = editor.createEmptyNode({ levelId: 't2', parentId: rootNode.nodeId, items: [{ id: 'c1', label: 'Child' }] });
            editor.nodes = [rootNode, childNode];
            editor.syncLevelsFromNodes();
            editor.renderLevels();

            const viewport = document.querySelector('#se-hierarchy-viewport');
            if (viewport) {
                Object.defineProperty(viewport, 'scrollWidth', { value: 1500, configurable: true });
                Object.defineProperty(viewport, 'clientWidth', { value: 600, configurable: true });
                Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true });
                Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true });
            }

            // Mock getBoundingClientRect
            const stage = document.querySelector('#se-hierarchy-stage');
            if (stage) {
                vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 });
            }
            const cards = document.querySelectorAll('.se-node-card[data-node-id]');
            cards.forEach((c, idx) => {
                vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({
                    left: 100 * idx,
                    top: 100 * idx,
                    width: 150,
                    height: 80
                });
            });

            editor.updateHierarchyMinimap();
            const minimapSvg = document.querySelector('#se-hierarchy-minimap svg');
            expect(minimapSvg).toBeTruthy();
            const paths = minimapSvg.querySelectorAll('path');
            expect(paths.length).toBeGreaterThan(0);
        });

        it('2.4: mode tab pill aligns with activeTab offsetLeft and offsetWidth', () => {
            mountEditorDom();
            const tabLinear = document.querySelector('#mode-tab-linear');
            const tabHierarchy = document.querySelector('#mode-tab-hierarchy');
            const pill = document.querySelector('#se-mode-tabs-pill');

            Object.defineProperty(tabHierarchy, 'offsetLeft', { value: 120, configurable: true });
            Object.defineProperty(tabHierarchy, 'offsetWidth', { value: 110, configurable: true });

            editor.updateDisplayModeControls(false);

            // Switch to hierarchy
            editor.displayMode = 'hierarchy';
            editor.updateDisplayModeControls(false);

            expect(pill.style.transform).toBe('translateX(120px)');
            expect(pill.style.width).toBe('110px');
        });
    });

    describe('Stage 3: Undo/Redo stack reliability and validation robustness', () => {
        beforeEach(() => {
            mountEditorDom();
            document.querySelector('#prompt-textarea').value = 'Расставьте в правильном порядке';
            document.querySelector('#task-name-input').value = 'Тестовое задание';
            editor.levels = [
                {
                    levelId: 'lvl-1',
                    title: 'Первый уровень',
                    items: [
                        { id: 'item-1', label: 'Шаг 1' },
                        { id: 'item-2', label: 'Шаг 2' },
                    ],
                },
            ];
            editor.nodes = [
                editor.createEmptyNode({
                    levelId: 'lvl-1',
                    parentId: null,
                    items: [
                        { id: 'item-1', label: 'Шаг 1' },
                        { id: 'item-2', label: 'Шаг 2' },
                    ],
                }),
            ];
            editor.displayMode = 'hierarchy';
            editor.syncLevelsFromNodes();
            editor.renderLevels();
            editor.undoManager.clear();
        });

        it('3.1: shouldDelegateUndoRedoFromInput returns true for sequence card inputs', () => {
            const cardInput = document.querySelector('.se-node-item-input');
            expect(cardInput).toBeTruthy();
            expect(editor.shouldDelegateUndoRedoFromInput(cardInput)).toBe(true);

            const externalInput = document.createElement('input');
            expect(editor.shouldDelegateUndoRedoFromInput(externalInput)).toBe(false);
        });

        it('3.1: typing text and fast undo flushes pending history save and undoes cleanly', () => {
            // Push initial state
            editor.saveStateToHistory();
            expect(editor.undoManager.getHistorySize()).toBe(1);

            const card = document.querySelector('.se-node-card');
            const textarea = card.querySelector('.se-node-item-input');
            expect(textarea).toBeTruthy();

            // Simulate typing
            textarea.value = 'Обновленный шаг 1';
            textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

            // Verify a debounce timer is scheduled
            expect(editor._historySaveTimeout).toBeTruthy();

            // Perform undo immediately (fast undo before 400ms)
            editor.performUndo();

            // Pending save was flushed, then undone back to initial state
            expect(editor.nodes[0].items[0].label).toBe('Шаг 1');

            // Perform redo immediately restores the typed text
            editor.performRedo();
            expect(editor.nodes[0].items[0].label).toBe('Обновленный шаг 1');
        });

        it('3.1: fast undo after deleteItemFromNode works synchronously without timer race', () => {
            editor.saveStateToHistory();
            const initialItemCount = editor.nodes[0].items.length;
            expect(initialItemCount).toBe(2);

            // Delete item 1
            editor.deleteItemFromNode(editor.nodes[0].nodeId, 1);
            expect(editor.nodes[0].items.length).toBe(1);

            // Immediate undo (even before 180ms DOM cleanup finishes)
            editor.performUndo();
            expect(editor.nodes[0].items.length).toBe(2);
            expect(editor.nodes[0].items[1].label).toBe('Шаг 2');
        });

        it('3.2: validateTask marks empty slot, sets se-shake, and clears card error on input', () => {
            // Make one item empty
            editor.nodes[0].items[1].label = '';
            editor.syncLevelsFromNodes();
            editor.renderLevels();

            const card = document.querySelector('.se-node-card');
            const textareas = card.querySelectorAll('.se-node-item-input');
            expect(textareas[1].value).toBe('');

            const error = editor.validateTask();
            expect(error).toBeTruthy();
            expect(card.classList.contains('se-node-card--error')).toBe(true);
            expect(card.classList.contains('se-shake')).toBe(true);
            expect(textareas[1].classList.contains('se-field--error')).toBe(true);

            // Typing into textareas[1] removes se-field--error and clears se-node-card--error
            textareas[1].value = 'Заполнено';
            textareas[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));

            expect(textareas[1].classList.contains('se-field--error')).toBe(false);
            expect(card.classList.contains('se-node-card--error')).toBe(false);
        });

        it('3.2: deleting an empty slot removes card error class via clearCardErrorIfResolved', () => {
            vi.useFakeTimers();
            try {
                editor.nodes[0].items[1].label = '';
                editor.syncLevelsFromNodes();
                editor.renderLevels();

                const card = document.querySelector('.se-node-card');
                editor.validateTask();
                expect(card.classList.contains('se-node-card--error')).toBe(true);

                // Delete the empty item
                editor.deleteItemFromNode(editor.nodes[0].nodeId, 1);
                vi.advanceTimersByTime(200);

                expect(card.classList.contains('se-node-card--error')).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('3.2: multiple empty slots validation message contains location of first item', () => {
            // Add a second node with empty items
            const secondNode = editor.createEmptyNode({
                levelId: 'lvl-1',
                parentId: null,
                items: [
                    { id: 'item-3', label: '' },
                ],
            });
            editor.nodes[0].items[0].label = '';
            editor.nodes[0].items[1].label = 'Заполненный шаг';
            editor.nodes.push(secondNode);
            editor.syncLevelsFromNodes();
            editor.renderLevels();

            const errorMsg = editor.validateTask();
            expect(errorMsg).toBeTruthy();
            expect(errorMsg).toContain('Обнаружено 2 незаполненных элементов');
            expect(errorMsg).toContain('«Заполненный шаг»');
        });
    });

    describe('Stage 2: 2D Columns Architecture (Levels × Columns)', () => {
        beforeEach(() => {
            editor.displayMode = 'hierarchy';
            editor.colorDifferentiation = true;
            editor.levels = [
                { levelId: 'lvl-1', title: 'Уровень 1', items: [{ id: 'it-1', label: 'Шаг 1' }] },
                { levelId: 'lvl-2', title: 'Уровень 2', items: [{ id: 'it-2', label: 'Шаг 2' }] },
                { levelId: 'lvl-3', title: 'Уровень 3', items: [{ id: 'it-3', label: 'Шаг 3' }] },
            ];
            editor.nodes = [
                editor.createEmptyNode({ levelId: 'lvl-1', parentId: null, items: [{ id: 'it-1', label: 'Шаг 1' }], columnTitle: 'Пневмоторакс' }),
                editor.createEmptyNode({ levelId: 'lvl-2', parentId: 'node_1', items: [{ id: 'it-2', label: 'Шаг 2' }] }),
                editor.createEmptyNode({ levelId: 'lvl-3', parentId: 'node_2', items: [{ id: 'it-3', label: 'Шаг 3' }] }),
            ];
            editor.nodes[0].nodeId = 'node_1';
            editor.nodes[1].nodeId = 'node_2';
            editor.nodes[2].nodeId = 'node_3';
        });

        it('2.1: parseNodes and buildStructure preserve column_title and createEmptyNode defaults', () => {
            const rawContent = {
                elements: [
                    { id: 'b1', text: 'Коллапс' },
                    { id: 'b2', text: 'Смещение' },
                ],
                nodes: [
                    { node_id: 'n1', level_id: 'lvl-1', parent_id: null, blocks: ['b1'], column_title: 'Пневмоторакс' },
                    { node_id: 'n2', level_id: 'lvl-2', parent_id: 'n1', blocks: ['b2'] },
                ],
            };
            const parsed = editor.parseNodes(rawContent);
            expect(parsed[0].columnTitle).toBe('Пневмоторакс');
            expect(parsed[1].columnTitle).toBe('');

            editor.nodes = parsed;
            const built = editor.buildStructure();
            expect(built.nodes[0].column_title).toBe('Пневмоторакс');
            expect(built.nodes[1].column_title).toBeUndefined();
        });

        it('2.2: addRootNode creates symmetric vertical column across all tiers with parent-child links', () => {
            expect(editor.levels).toHaveLength(3);
            expect(editor.nodes).toHaveLength(3);

            editor.addRootNode();

            // Total nodes should now be 6 (original 3 + 3 new in new column)
            expect(editor.nodes).toHaveLength(6);
            const roots = editor.nodes.filter(n => !n.parentId);
            expect(roots).toHaveLength(2);

            const newRoot = roots[1];
            expect(newRoot.levelId).toBe('lvl-1');

            // Find children in new column
            const child1 = editor.nodes.find(n => n.parentId === newRoot.nodeId);
            expect(child1).toBeTruthy();
            expect(child1.levelId).toBe('lvl-2');

            const child2 = editor.nodes.find(n => n.parentId === child1.nodeId);
            expect(child2).toBeTruthy();
            expect(child2.levelId).toBe('lvl-3');
        });

        it('2.3: renders column headers at gridRow: 1, corner spacer at (1, 1), and shifts tiers to gridRow: 2+', () => {
            editor.addRootNode();
            editor.renderLevels();

            const grid = document.querySelector('.se-hierarchy-grid');
            expect(grid).toBeTruthy();

            // 1. Clean open-air corner spacer
            const corner = grid.querySelector('.se-grid-corner-spacer');
            expect(corner).toBeTruthy();
            expect(corner.style.gridColumn).toBe('1 / 2');
            expect(corner.style.gridRow).toBe('1');

            // 2. Column Headers
            const colHeaders = grid.querySelectorAll('.se-col-header-cell');
            expect(colHeaders).toHaveLength(2);
            expect(colHeaders[0].querySelector('.se-col-badge').textContent).toContain('I КОЛОНКА');
            expect(colHeaders[1].querySelector('.se-col-badge').textContent).toContain('II КОЛОНКА');

            // 3. Column Lanes
            const colLanes = grid.querySelectorAll('.se-col-lane');
            expect(colLanes).toHaveLength(2);
            expect(colLanes[0].style.gridRow).toBe('1 / 5');

            // 4. Horizontal Tiers shifted to row 2+
            const tierCells = grid.querySelectorAll('.se-tier-cell');
            expect(tierCells).toHaveLength(3);
            expect(tierCells[0].style.gridRow).toBe('2');
            expect(tierCells[1].style.gridRow).toBe('3');
            expect(tierCells[2].style.gridRow).toBe('4');
        });

        it('2.4: typing columnTitle in col-title-input updates rootNode.columnTitle and synchronizes .se-node-col-tag across cards', () => {
            editor.addRootNode();
            editor.renderLevels();

            const grid = document.querySelector('.se-hierarchy-grid');
            const colHeader2 = grid.querySelectorAll('.se-col-header-cell')[1];
            const titleInput = colHeader2.querySelector('.col-title-input');

            // Type 'Обтурационный ателектаз'
            titleInput.value = 'Обтурационный ателектаз';
            titleInput.dispatchEvent(new dom.window.Event('input'));

            const roots = editor.nodes.filter(n => !n.parentId);
            expect(roots[1].columnTitle).toBe('Обтурационный ателектаз');

            // Check that all cards in column 1 (0-indexed) have updated tag
            const col1Tags = grid.querySelectorAll('.se-node-col-tag[data-col-idx="1"]');
            expect(col1Tags.length).toBeGreaterThanOrEqual(1);
            col1Tags.forEach(tag => {
                expect(tag.textContent).toContain('II');
                expect(tag.textContent).toContain('Обтурационный ателектаз');
            });
        });

        it('2.5: moveNodeSibling reorders root columns and preserves subtrees', () => {
            editor.addRootNode();
            const roots = editor.nodes.filter(n => !n.parentId);
            roots[0].columnTitle = 'Пневмоторакс';
            roots[1].columnTitle = 'Ателектаз';
            editor.renderLevels();

            // Move first root right
            editor.moveNodeSibling(roots[0].nodeId, 1);

            const newRoots = editor.nodes.filter(n => !n.parentId);
            expect(newRoots[0].columnTitle).toBe('Ателектаз');
            expect(newRoots[1].columnTitle).toBe('Пневмоторакс');
        });
    });

    describe('Stage 1: Hierarchy Onboarding Handbook & Sister Tour Bridging', () => {
        it('1.1: loads 2-col × 2-tier clinical matrix demo on hierarchy onboarding tour', () => {
            editor.applySequenceOnboardingDemoState('sequence-hierarchy-editor-authoring');

            expect(editor.displayMode).toBe('hierarchy');
            expect(editor.levels).toHaveLength(2);
            expect(editor.nodes).toHaveLength(4);
            expect(editor.task.task_data.name).toContain('ТЭЛА');

            const grid = document.querySelector('.se-hierarchy-grid');
            expect(grid).not.toBeNull();
            expect(grid.querySelector('[data-onboarding-target="sequence-hierarchy-first-column"]')).not.toBeNull();
            expect(grid.querySelector('[data-onboarding-target="sequence-hierarchy-first-tier"]')).not.toBeNull();
            expect(grid.querySelector('[data-onboarding-target="sequence-hierarchy-first-node"]')).not.toBeNull();

            const toolbar = document.querySelector('#se-hierarchy-toolbar');
            expect(toolbar.querySelector('[data-onboarding-target="sequence-hierarchy-add-column"]')).not.toBeNull();
            expect(toolbar.querySelector('[data-onboarding-target="sequence-hierarchy-add-tier"]')).not.toBeNull();
        });

        it('1.2: dynamic help button updates tour id based on active displayMode', () => {
            const helpBtn = document.querySelector('[data-onboarding-help-button]');
            expect(helpBtn).not.toBeNull();

            editor.setDisplayMode('linear');
            expect(helpBtn.getAttribute('data-onboarding-tour-id')).toBe('sequence-editor-authoring');
            expect(dom.window.ACTRA_ONBOARDING_HELP.getTourId()).toBe('sequence-editor-authoring');

            editor.setDisplayMode('hierarchy');
            expect(helpBtn.getAttribute('data-onboarding-tour-id')).toBe('sequence-hierarchy-editor-authoring');
            expect(dom.window.ACTRA_ONBOARDING_HELP.getTourId()).toBe('sequence-hierarchy-editor-authoring');
        });

        it('1.3: preserves snapshot when branching between sister tours and restores upon exit', () => {
            editor.setupSequenceOnboardingTourBridge();
            // Setup custom author state
            editor.setDisplayMode('linear');
            editor.levels = [
                { levelId: 'l_author', title: 'Авторский уровень', items: [{ id: 'e1', label: 'Шаг автора' }] }
            ];
            editor.hasUnsavedChanges = true;

            // Trigger linear onboarding tour
            dom.window.dispatchEvent(new dom.window.CustomEvent('onboarding:before-start', {
                detail: { tourId: 'sequence-editor-authoring', preview: false }
            }));
            expect(editor.sequenceOnboardingDemoActive).toBe(true);
            expect(editor.task.task_data.name).toContain('раствора');

            // Branch into sister hierarchy onboarding tour without restoring yet
            dom.window.dispatchEvent(new dom.window.CustomEvent('onboarding:finish', {
                detail: { tourId: 'sequence-editor-authoring', nextTourId: 'sequence-hierarchy-editor-authoring' }
            }));
            // Snapshot should still be active, state switched to hierarchy demo
            expect(editor.sequenceOnboardingDemoActive).toBe(true);
            expect(editor.displayMode).toBe('hierarchy');
            expect(editor.task.task_data.name).toContain('ТЭЛА');

            // Finish hierarchy tour completely
            dom.window.dispatchEvent(new dom.window.CustomEvent('onboarding:finish', {
                detail: { tourId: 'sequence-hierarchy-editor-authoring' }
            }));

            // Author state must be fully restored!
            expect(editor.sequenceOnboardingDemoActive).toBe(false);
            expect(editor.displayMode).toBe('linear');
            expect(editor.levels[0].title).toBe('Авторский уровень');
            expect(editor.levels[0].items[0].label).toBe('Шаг автора');
            expect(editor.hasUnsavedChanges).toBe(true);
        });
    });
});


