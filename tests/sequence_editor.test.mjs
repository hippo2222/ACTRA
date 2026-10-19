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
        <button id="add-level-btn"></button>
        <button id="save-task-btn"></button>
        <input id="block-image-upload" type="file" />
        <aside>
            <div id="sequence-sidebar-content" class="p-5 space-y-6">
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
});


