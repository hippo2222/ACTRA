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
        <input id="task-name-input" />
        <textarea id="prompt-textarea"></textarea>
        <input id="order-inside-matters" type="checkbox" />
        <input id="level-order-matters" type="checkbox" />
        <div id="settings-help-text"></div>
        <div id="levels-container"></div>
        <button id="clear-all-btn"></button>
        <button id="add-level-btn"></button>
        <button id="save-task-btn"></button>
        <input id="block-image-upload" type="file" />
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
});
